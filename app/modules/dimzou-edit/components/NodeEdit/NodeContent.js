import {
  useContext,
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { useSelector, useDispatch } from 'react-redux';
import PropTypes from 'prop-types';
import Router, { useRouter } from 'next/router';
import classNames from 'classnames';
import {
  WindowScroller,
  InfiniteLoader,
  CellMeasurerCache,
  CellMeasurer,
  List,
} from 'react-virtualized';
import { selectCurrentUser } from '@/modules/auth/selectors';
import { formatMessage } from '@/services/intl';
import message from '@feat/feat-ui/lib/message';
import groupBy from 'lodash/groupBy';
import get from 'lodash/get';
import findIndex from 'lodash/findIndex';
import {
  selectUserRelatedDrafts,
  selectUserDraftsState,
} from '../../selectors';
import commonMessages from '@/messages/common';
import { BEGINNING_PIVOT, TAILING_PIVOT, ROLE_OWNER } from '../../constants';
import {
  NodeContext,
  BundleContext,
  UserCapabilitiesContext,
  ScrollContext,
  OwnerContext,
} from '../../context';
import MeasureProvider from '../../providers/MeasureProvider';
import {
  commitMediaBlock,
  submitMediaBlock,
  asyncUpdateNodeInfo,
} from '../../actions';
import RewordableSection from '../RewordableSection';
import ContentBlockRender from '../ContentBlockRender';
import AppendingBlock from '../AppendingBlock';
import DropHint from '../DropHint';
import intlMessages from '../../messages';
import { getActiveHash } from './utils';
import { getAsPath } from '../../utils/router';
import { groupByStatus } from '../../utils/bundle';
import { getNodeCache } from '../../utils/cache';
const TRANSITION_DURATION = 100;
const DROP_REGION_HEIGHT = 40;
const PARA_NUM_OFFSET = 56;
const CONTENT_WIDTH = 720;
const ELEMENT_DEFAULT_HEIGHT = 160;
function NodeContent(props) {
  const nodeState = useContext(NodeContext);
  const bundleState = useContext(BundleContext);
  const userCapabilities = useContext(UserCapabilitiesContext);
  const ownerContext = useContext(OwnerContext);
  const { uid } = ownerContext;
  const currentUser = useSelector(selectCurrentUser);
  const scrollContext = useContext(ScrollContext);
  const currentUserDrafts = useSelector(selectUserDraftsState); // get current user's drafts, you are the current user
  const userDrafts = useSelector((state) =>
    selectUserRelatedDrafts(state, { userId: uid }),
  ); // get other users's drafts, when you browsing other users' dimzou page
  const dispatch = useDispatch();
  const domRef = useRef(null);
  // const nameIndexMap = useRef({});
  const [beginIndex, setBeginIndex] = useState(0);
  const hasInitScrolled = useRef(false);
  const router = useRouter();
  const [scrollToIndex, setScrollToIndex] = useState(-1);

  const { mode } = bundleState;
  const { data: node, appendings, outline } = nodeState;
  const { content, node_paragraphs_count } = node;

  // loading提示
  const [isLoading, setLoading] = useState(false);
  const [scrollTime, setScrollTime] = useState(10);
  const [scrollDirection, setDirection] = useState(0);
  const [lastParagraphId, setParagraphId] = useState(-1);
  const scrollDirectionRef = useRef(0);

  const [data, setData] = useState(
    Array.from({ length: nodeState.data.node_paragraphs_count }).map(
      // eslint-disable-next-line no-unused-vars
      (_) => null,
    ),
  );

  // check if on current user's dimzou page
  const isCurrentDimZou = useMemo(() => uid === currentUser.uid, [uid]);

  const drafts = useMemo(
    () => {
      const output = {};
      // check if user on their Dimzou page and decide to use context
      const { data: draftData, loaded, ids } = isCurrentDimZou
        ? currentUserDrafts
        : userDrafts;

      const extraNodes = loaded.filter((item) => !ids[item.id]);
      const flatNodes = draftData
        ? draftData.reduce(
          (els, bundle) =>
            els.concat(bundle, bundle.all_copies ? bundle.all_copies : []),
          [],
        )
        : [];
      const bundleNodes = [...extraNodes, ...flatNodes];

      const roleGrouped = groupBy(bundleNodes, (bundle) => {
        const collaborators = get(bundle, 'nodes.0.collaborators');
        if (collaborators) {
          const info = collaborators.find(
            (item) => item.user && item.user.uid === uid,
          );
          if (info && info.role === ROLE_OWNER) {
            return 'created';
          }
          return 'participated';
        }
        if (bundle.user && bundle.user.uid === uid) {
          return 'created';
        }
        return 'participated';
      });
      Object.keys(roleGrouped).forEach((key) => {
        output[key] = groupByStatus(roleGrouped[key]);
      });
      if (roleGrouped.created && roleGrouped.created.length) {
        output.hasCreated = true;
      }
      if (roleGrouped.participated && roleGrouped.participated.length) {
        output.hasParticipated = true;
      }
      return output.created.draft;
    },
    [uid],
  );

  const [blockSections, nameIndexMap] = useMemo(
    () => {
      const sections = [];
      const indexMap = {};
      const tempData = [
        ...Array.from({ length: nodeState.data.node_paragraphs_count - 2 }).map(
          // eslint-disable-next-line no-unused-vars
          (_) => null,
        ),
      ];
      let counter = 0;
      if (!content) {
        return sections;
      }
      const blockCount = content.length;
      const lastBlockId = blockCount
        ? content[blockCount - 1].id
        : BEGINNING_PIVOT;
      content.forEach((block, index) => {
        const appendingBlock = appendings[block.id];
        sections.push({
          component: RewordableSection,
          props: {
            key: block.id,
            mode,
            structure: 'content',
            bundleId: node.bundle_id,
            nodeId: node.id,
            blockId: block.id,
            info: block.info,
            rewordings: block.rewordings,
            status: block.status,
            sort: block.sort,
            isLastBlock: index + 1 === blockCount,
            currentUser,
            userCapabilities,
            render: ContentBlockRender,
            name: `content-${block.id}`,
          },
        });

        tempData[block.sort - 1] = {
          component: RewordableSection,
          props: {
            key: block.id,
            mode,
            structure: 'content',
            bundleId: node.bundle_id,
            nodeId: node.id,
            blockId: block.id,
            info: block.info,
            rewordings: block.rewordings,
            status: block.status,
            sort: block.sort,
            isLastBlock: index + 1 === blockCount,
            currentUser,
            userCapabilities,
            render: ContentBlockRender,
            name: `content-${block.id}`,
          },
        };

        indexMap[`content-${block.id}`] = counter;
        counter += 1;
        if (appendingBlock) {
          sections.push({
            component: AppendingBlock,
            props: {
              bundleId: node.bundle_id,
              nodeId: node.id,
              pivotId: block.id,
              userCapabilities,
              key: `appending_${block.id}`,
              placeholder: formatMessage(intlMessages.insertEditorPlaceholder),
              currentUser,
            },
          });
          counter += 1;
          // tempData.push({
          //   component: AppendingBlock,
          //   props: {
          //     bundleId: node.bundle_id,
          //     nodeId: node.id,
          //     pivotId: block.id,
          //     userCapabilities,
          //     key: `appending_${block.id}`,
          //     placeholder: formatMessage(intlMessages.insertEditorPlaceholder),
          //     currentUser,
          //   },
          // });
        }
      });
      if (
        userCapabilities.canEdit &&
        userCapabilities.canAppendContent &&
        Object.keys(appendings).length === 0
      ) {
        sections.push({
          component: AppendingBlock,
          props: {
            bundleId: node.bundle_id,
            nodeId: node.id,
            pivotId: TAILING_PIVOT,
            lastBlockId,
            userCapabilities,
            key: TAILING_PIVOT,
            placeholder: formatMessage(intlMessages.tailingEditorPlaceholder),
            currentUser,
          },
        });

        if (content.length - node_paragraphs_count >= -2) {
          tempData[content.length] = {
            component: AppendingBlock,
            props: {
              bundleId: node.bundle_id,
              nodeId: node.id,
              pivotId: TAILING_PIVOT,
              lastBlockId,
              userCapabilities,
              key: TAILING_PIVOT,
              placeholder: formatMessage(intlMessages.tailingEditorPlaceholder),
              currentUser,
              sort: tempData.length + 1,
            },
          };
        } else {
          tempData.splice(-1, 1, {
            component: AppendingBlock,
            props: {
              bundleId: node.bundle_id,
              nodeId: node.id,
              pivotId: TAILING_PIVOT,
              lastBlockId,
              userCapabilities,
              key: TAILING_PIVOT,
              placeholder: formatMessage(intlMessages.tailingEditorPlaceholder),
              currentUser,
              sort: tempData.length,
            },
          });
        }
      }
      setData(tempData);
      return [sections, indexMap];
    },
    [content, appendings, userCapabilities],
  );

  // detect if view needs to be scrolled to bottom
  const handleScrollToBottom = () => {
    const element = document.documentElement;
    const { clientHeight, scrollHeight } = element;
    element.scrollTop = scrollHeight - clientHeight;
  };

  useEffect(
    () => {
      if (scrollContext && scrollContext.scrollToBottom) {
        const lastParagraph = document.querySelector(
          `[name=content_${lastParagraphId}]`,
        );
        if (lastParagraph === null) {
          handleScrollToBottom();
        } else {
          lastParagraph.scrollIntoView(true);
          scrollContext.setScrollToBottom(false);
        }
      }
    },
    [document.documentElement.scrollHeight, lastParagraphId],
  );

  const getLastParagraphInfor = () => {
    if (lastParagraphId === -1) {
      const paragraph = content.filter((p) => p.sort === node_paragraphs_count);
      if (paragraph.length && paragraph[0].id) {
        setParagraphId(paragraph[0].id);
      }
    }
  };

  useEffect(() => {
    if (scrollContext && scrollContext.scrollToBottom) {
      getLastParagraphInfor();
      handleScrollToBottom();
    }
  });

  const updateHref = (bundle_id, node_id) => ({
    href: {
      pathname: '/dimzou-edit',
      query: {
        bundleId: bundle_id,
        nodeId: node_id,
      },
    },
    as: getAsPath({
      query: {
        bundleId: bundle_id,
        nodeId: node_id,
      },
    }),
  });

  // direct to previous bundle
  const toPreviousBundle = () => {
    const bundleIndex = findIndex(
      drafts,
      (draft) => draft.id === bundleState.data.id,
    );
    // check if previous bundle exist
    const hasPreviousBundle = drafts.length > 1 && bundleIndex > 0;
    if (hasPreviousBundle) {
      // get previous bundle infor
      const previousBundleIndex = bundleIndex - 1;
      const previousBundleId = drafts[previousBundleIndex].id;
      const nodeLength = drafts[previousBundleIndex].nodes
        ? drafts[previousBundleIndex].nodes.length
        : 0;
      const previousBundleNodeId = drafts[previousBundleIndex].nodes
        ? drafts[previousBundleIndex].nodes[nodeLength - 1].id
        : undefined;

      // update href
      const newHref = updateHref(previousBundleId, previousBundleNodeId);

      // to previous Bundle
      scrollContext.setScrollToBottom(true);
      router.push(newHref.href, newHref.as);
    }
  };

  // direct to next bundle
  const toNextBundle = () => {
    const bundleIndex = findIndex(
      drafts,
      (draft) => draft.id === bundleState.data.id,
    );
    // check if next bundle exist
    const hasNextBundle = drafts.length > 1 && bundleIndex < drafts.length - 1;
    if (hasNextBundle) {
      // get next bundle infor
      const nextBundleId = drafts[bundleIndex + 1].id;
      const nextBundleNodeId = drafts[bundleIndex + 1].nodes
        ? drafts[bundleIndex + 1].nodes[0].id
        : undefined;

      // update href
      const newHref = updateHref(nextBundleId, nextBundleNodeId);

      // to next Bundle
      window.scrollTo(0, 0);
      router.push(newHref.href, newHref.as);
    }
  };

  const resetScrollTime = () => setScrollTime(10);

  useEffect(
    () => {
      if (
        scrollDirection < 0 &&
        scrollDirection === scrollDirectionRef.current
      ) {
        // scrolled up
        if (scrollTime === 0) {
          resetScrollTime();
          toPreviousBundle();
        }
      }
      if (
        scrollDirection > 0 &&
        scrollDirection === scrollDirectionRef.current
      ) {
        // scroll down
        if (scrollTime === 0) {
          resetScrollTime();
          toNextBundle();
        }
      }
      scrollDirectionRef.current = scrollDirection;
    },
    [scrollTime, scrollDirection],
  );

  // function that works for the scroll listerner
  const listernToScroll = (event) => {
    if (scrollContext && scrollContext.scrollToBottom) {
      scrollContext.setScrollToBottom(false);
    }
    const winScroll =
      document.body.scrollTop || document.documentElement.scrollTop;
    const height =
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight;
    const scrolled = winScroll / height;
    if (scrolled === 0 && event.deltaY < 0) {
      setDirection(event.deltaY);
      setScrollTime((preScrollTime) => preScrollTime - 1);
    } else if (scrolled > 0.999 && event.deltaY > 0) {
      setDirection(event.deltaY);
      setScrollTime((preScrollTime) => preScrollTime - 1);
    } else {
      resetScrollTime();
    }
  };

  useEffect(() => {
    const mainContainer = document.querySelector(`[class*="__mainContainer"]`);
    if (mainContainer !== null) {
      mainContainer.addEventListener('wheel', listernToScroll);
    }
    return () => {
      if (mainContainer !== null) {
        mainContainer.removeEventListener('wheel', listernToScroll);
      }
      resetScrollTime();
    };
  }, []);

  // react-virtualized related
  const cacheRef = useRef(
    new CellMeasurerCache({
      fixedWidth: true,
      defaultHeight: ELEMENT_DEFAULT_HEIGHT,
    }),
  );
  // update width --- start
  // ------
  const [width, setWidth] = useState(CONTENT_WIDTH);
  useEffect(() => {
    const updateWidth = () => {
      if (domRef.current) {
        const { clientWidth } = domRef.current;
        setWidth(clientWidth);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => {
      window.removeEventListener('resize', updateWidth);
    };
  }, []);
  // update width -- end
  // image upload feature -- start
  // ------
  const [dropPivotIndex, setDropPivotIndex] = useState(null);
  const [inDropzone, setInDropZone] = useState(false);
  const pointerY = useRef(null);
  const getTop = useCallback(
    () => {
      const offset = dropPivotIndex - beginIndex;
      if (offset === -1) {
        return 0;
      }
      const block = domRef.current.querySelectorAll('.dz-BlockSectionWrap')[
        offset
      ];
      if (!block) {
        return 0;
      }
      return block.offsetTop + block.clientHeight;
    },
    [dropPivotIndex, beginIndex],
  );
  useEffect(
    () => {
      const dom = domRef.current;
      const handleDropOver = (e) => {
        if (!inDropzone) {
          return;
        }
        const isInRewordingDropzone = !!e.target.closest(
          '.dz-RewordingDropzone',
        );
        if (isInRewordingDropzone) {
          if (inDropzone) {
            setInDropZone(false);
          }
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        // if (e.dataTransfer.files && e.dataTransfer.files.length) {
        //   setInDropZone(true)
        // }
        const { clientY } = e;
        if (clientY !== pointerY.current) {
          pointerY.current = clientY;
          const blocks = domRef.current.querySelectorAll('.dz-BlockSection');
          let blockIndex;
          for (let i = 0; i < blocks.length; i += 1) {
            const block = blocks[i];
            if (!block) {
              continue;
            }
            const box = block.getBoundingClientRect();
            const { top, height } = box;
            // logging.debug(top, height, clientY)
            if (top + height / 2 > clientY) {
              blockIndex = i - 1;
              break;
            }
            if (top + height > clientY) {
              blockIndex = i;
              break;
            }
          }
          // logging.debug(blockIndex);
          if (blockIndex !== undefined) {
            setDropPivotIndex(beginIndex + blockIndex);
          }
        }
      };
      const handleDragEnter = (e) => {
        const { dataTransfer } = e;
        logging.debug('enter');
        e.stopPropagation();
        e.preventDefault();
        if (dataTransfer.types && dataTransfer.types[0] === 'Files') {
          logging.debug('active');
          setInDropZone(true);
          // setFileDropActive(true)
        }
      };
      const handleDragLeave = (e) => {
        logging.debug('leave');
        if (!inDropzone) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        // logging.debug(e.target, e.relatedTarget)
        if (
          e.target.contains(e.relatedTarget) ||
          dom.contains(e.relatedTarget)
        ) {
          return;
        }
        setInDropZone(false);
      };
      const handleDragEnd = (e) => {
        logging.debug('end');
        if (!inDropzone) {
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        // setFileDropActive(false)
      };
      const handleDrop = (e) => {
        logging.debug('drop');
        if (!inDropzone) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (/^image\/.*/.test(file.type)) {
          const creator = userCapabilities.canElect
            ? commitMediaBlock
            : submitMediaBlock;
          // create media block;
          if (!blockSections) {
            return;
          }
          dispatch(
            creator({
              bundleId: node.bundle_id,
              nodeId: node.id,
              pivotId:
                dropPivotIndex === -1
                  ? BEGINNING_PIVOT
                  : blockSections[dropPivotIndex].props.blockId,
              file,
            }),
          );
        } else {
          message.error(formatMessage(intlMessages.fileTypeNotSupported));
          logging.warn(`DIMZOU_UPLOAD_TYPE_RECEIVED: ${file.type}`);
        }
        setInDropZone(false);
      };
      dom.addEventListener('dragenter', handleDragEnter);
      dom.addEventListener('dragend', handleDragEnd);
      dom.addEventListener('dragover', handleDropOver);
      dom.addEventListener('dragleave', handleDragLeave);
      dom.addEventListener('drop', handleDrop);
      // window.addEventListener('drop', (e) => {
      //   e.preventDefault()
      // })
      // window.addEventListener('dragover', (e) => {
      //   e.preventDefault()
      // })
      return () => {
        dom.removeEventListener('dragenter', handleDragEnter);
        dom.removeEventListener('dragend', handleDragEnd);
        dom.removeEventListener('dragover', handleDropOver);
        dom.removeEventListener('dragleave', handleDragLeave);
        dom.removeEventListener('drop', handleDrop);
      };
    },
    [beginIndex, inDropzone, blockSections, dropPivotIndex],
  );
  // const [hash, setHash] = useState(workspace.hash);
  const renderInfoRef = useRef(null);
  function scrollToHash(hash, renderInfo) {
    const index = nameIndexMap[hash.replace('#', '')];
    if (index === undefined || !renderInfo) {
      return;
    }
    scrollContext.onScrollStarted();
    // if (
    //   renderInfo.overscanStartIndex <= index &&
    //   renderInfo.overscanStopIndex >= index
    // ) {
    //   const dom = document.querySelector(hash);
    //   if (dom) {
    //     dom.scrollIntoView(true);
    //     setTimeout(() => {
    //       scrollContext.onScrollFinished();
    //     }, 500);
    //     // window.scrollTo(0, window.scrollY - 120);
    //   } else {
    //     scrollContext.onScrollFinished();
    //   }
    // } else {
    //   const delta = index - renderInfo.startIndex;
    //   const deltaY = delta * ELEMENT_DEFAULT_HEIGHT;
    //   window.scrollTo(0, window.scrollY + deltaY);
    // }
  }
  // 清理 location.hash
  useEffect(() => {
    const removeHash = () => {
      if (window.location.hash) {
        Router.replace(
          {
            pathname: Router.pathname,
            query: Router.query,
          },
          window.location.pathname,
        );
      }
    };
    window.addEventListener('mousewheel', removeHash);
    return () => {
      window.removeEventListener('mousewheel', removeHash);
    };
  }, []);
  const handleRowsRendered = (info) => {
    setBeginIndex(info.overscanStartIndex);
    renderInfoRef.current = info;
    // logging.debug('handleRowsRendered', scrollContext, info);
    if (
      scrollContext.scrollHash &&
      /^#content-/.test(scrollContext.scrollHash)
    ) {
      scrollToHash(scrollContext.scrollHash, info);
    } else {
      // scrollContext.updateRenderInfo(info);
      const activeHash = getActiveHash(outline, info);
      scrollContext.setActiveHash(activeHash);
      if (hasInitScrolled.current) {
        const cache = getNodeCache(node.id);
        cache &&
          cache.set('contentScroll', {
            activeHash,
            startIndex: info.startIndex,
            blockId:
              blockSections[info.startIndex].props.blockId ||
              blockSections[info.startIndex].props.pivotId,
          });
      }
    }
    if (
      scrollContext &&
      scrollContext.scrollToBottom &&
      info.stopIndex === node_paragraphs_count
    ) {
      scrollContext.setScrollToBottom(false);
    }
  };
  // 当切换其他章节时，这个方法可以确保页面不会跳动，但是在上下滚动时会出现跳动。需要检测滚动方向，确定优先渲染当组件
  if (!props.isActive) {
    const height = domRef.current ? domRef.current.clientHeight : '100%';
    const style = { height };
    return (
      <div
        className="dz-BlockSectionContainer dz-BlockSectionContainer_placeholder"
        style={style}
        ref={domRef}
      />
    );
  }

  useEffect(
    () => {
      scrollContext.sort && setScrollToIndex(scrollContext.sort);
      scrollContext.setActiveHash(scrollContext.scrollHash);
      scrollContext.setSort(undefined);
      const index = nameIndexMap[scrollContext.scrollHash.replace('#', '')];
      if (!index && scrollContext.paragraphId) {
        dispatch(
          asyncUpdateNodeInfo({
            nodeId: node.id,
            paragraphId: scrollContext.paragraphId,
          }),
        ).then(() => {
          scrollToParagraph(scrollContext.scrollHash);
        });
        dispatch(
          asyncUpdateNodeInfo({
            nodeId: node.id,
            paragraphId: scrollContext.paragraphId,
            forward: 1,
          }),
        );
      }
    },
    [scrollContext.sort],
  );

  const scrollToParagraph = (hash) => {
    setTimeout(() => {
      // const dom = document.querySelector(hash);
      const dom = document.getElementById(hash.replace('#', ''));
      if (dom) {
        dom.scrollIntoView(true);
        setTimeout(() => {
          scrollContext.onScrollFinished();
        }, 500);
        // window.scrollTo(0, window.scrollY - 120);
      } else {
        scrollContext.onScrollFinished();
      }
    }, 1000);
  };

  const clearScrollToIndex = () => {
    setScrollToIndex(-1);
  };

  // 判断是否加载更多数据
  const isRowLoaded = ({ index }) => !!data[index];

  // eslint-disable-next-line arrow-body-style
  const loadMoreRows = ({ startIndex, stopIndex }) => {
    // 加载更多数据
    const tempStartNode = content.find((item) => item.sort === startIndex);
    const tempStopNode = content.find((item) => item.sort === stopIndex + 3);
    if (tempStartNode) {
      setLoading(true);
      return dispatch(
        asyncUpdateNodeInfo({
          nodeId: node.id,
          paragraphId: tempStartNode.id,
        }),
      ).then(() => {
        setLoading(false);
      });
    }
    if (tempStopNode) {
      setLoading(true);
      return dispatch(
        asyncUpdateNodeInfo({
          nodeId: node.id,
          paragraphId: tempStopNode.id,
          forward: 1,
        }),
      ).then(() => {
        setLoading(false);
      });
    }
    return Promise.resolve();
  };
  // eslint-disable-next-line arrow-body-style
  const loadNextRows = isLoading ? () => Promise.resolve() : loadMoreRows;
  const toIndex = scrollToIndex;
  const nodeLength = blockSections ? blockSections.length : 0;
  return (
    <InfiniteLoader
      isRowLoaded={isRowLoaded}
      loadMoreRows={loadNextRows}
      rowCount={
        node_paragraphs_count - 2 > nodeLength
          ? node_paragraphs_count - 2
          : nodeLength
      }
      threshold={20}
    >
      {({ onRowsRendered, registerChild }) => (
        <WindowScroller key={node.id} onScroll={clearScrollToIndex}>
          {({ height, isScrolling, onChildScroll, scrollTop }) => (
            <div
              ref={(el) => {
                domRef.current = el;
                // registerChild(el);
              }}
              className={classNames(
                'dz-BlockSectionContainer',
                props.className,
              )}
              style={{ left: -1 * PARA_NUM_OFFSET, position: 'relative' }}
            >
              <List
                autoHeight
                height={height}
                ref={registerChild}
                isScrolling={isScrolling}
                onScroll={onChildScroll}
                rowCount={
                  node_paragraphs_count - 2 > nodeLength
                    ? node_paragraphs_count - 2
                    : nodeLength
                }
                rowHeight={cacheRef.current.rowHeight}
                scrollTop={scrollTop}
                deferredMeasurementCache={cacheRef.current}
                scrollToIndex={toIndex}
                width={width + PARA_NUM_OFFSET}
                onRowsRendered={(info) => {
                  handleRowsRendered(info);
                  onRowsRendered(info);
                }}
                // tabIndex={-1}
                // overscanRowCount={8}
                style={{ counterReset: `para ${Math.max(beginIndex)}` }}
                rowRenderer={({ index, key, parent, style }) => {
                  let blockStyle;
                  if (inDropzone) {
                    if (
                      dropPivotIndex !== undefined &&
                      index > dropPivotIndex
                    ) {
                      blockStyle = {
                        ...style,
                        transition: `transform ${TRANSITION_DURATION}ms ease`,
                        transform: `translate3d(0px, ${DROP_REGION_HEIGHT}px, 0px)`,
                        paddingLeft: PARA_NUM_OFFSET,
                      };
                    } else {
                      blockStyle = {
                        ...style,
                        transition: `transform ${TRANSITION_DURATION}ms ease`,
                        paddingLeft: PARA_NUM_OFFSET,
                      };
                    }
                  } else {
                    blockStyle = {
                      ...style,
                      paddingLeft: PARA_NUM_OFFSET,
                    };
                  }

                  // const blockSection = blockSections && blockSections[index];
                  const blockSection = data && data[index];

                  if (blockSection) {
                    const {
                      component: Compo,
                      props: compoProps,
                    } = blockSection;
                    return (
                      <CellMeasurer
                        key={key}
                        cache={cacheRef.current}
                        parent={parent}
                        columnIndex={0}
                        rowIndex={index}
                      >
                        {(cellMeasure) => (
                          <MeasureProvider {...cellMeasure}>
                            <div
                              className="dz-BlockSectionWrap"
                              style={blockStyle}
                            >
                              <Compo {...compoProps} />
                            </div>
                          </MeasureProvider>
                        )}
                      </CellMeasurer>
                    );
                  }

                  return (
                    <CellMeasurer
                      cache={cacheRef.current}
                      columnIndex={0}
                      key={key}
                      parent={parent}
                      rowIndex={index}
                    >
                      {(cellMeasure) => (
                        <MeasureProvider {...cellMeasure}>
                          <div
                            className="dz-BlockSectionWrap"
                            style={blockStyle}
                          >
                            <div className="dz-BlockSectionLoading">
                              {formatMessage(commonMessages.loading)}
                            </div>
                          </div>
                        </MeasureProvider>
                      )}
                    </CellMeasurer>
                  );
                }}
              />
              {inDropzone && (
                <DropHint left={PARA_NUM_OFFSET} top={getTop()} height={2} />
              )}
              {isLoading && (
                <div className="dz-BlockSectionLoading">
                  {formatMessage(commonMessages.loading)}
                </div>
              )}
            </div>
          )}
        </WindowScroller>
      )}
    </InfiniteLoader>
  );
}
NodeContent.propTypes = {
  className: PropTypes.string,
  isActive: PropTypes.bool,
};
NodeContent.defaultProps = {
  isActive: true,
};
export default NodeContent;
