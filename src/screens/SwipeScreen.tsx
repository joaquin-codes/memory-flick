import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  PanResponder, Dimensions, FlatList, Modal, Pressable,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { RootStackParamList } from '../navigation/types';
import { estimateAssetBytes, formatBytes, fetchRealAssetSize } from '../utils/mediaLibrary';
import { useMediaStore, PendingAsset } from '../store/useMediaStore';
import * as MediaLibrary from 'expo-media-library';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 120;
const CARD_W = SCREEN_WIDTH - 48;       // 24 margin each side
const PRELOAD_AHEAD = 3;                // how many upcoming cards to warm-cache

type Props = NativeStackScreenProps<RootStackParamList, 'Swipe'>;

export default function SwipeScreen({ route, navigation }: Props) {
  const { monthKey, filter } = route.params;
  const insets = useSafeAreaInsets();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortBySize, setSortBySize] = useState(true);
  const [hideReviewed, setHideReviewed] = useState(false);
  const [sortDropdown, setSortDropdown] = useState(false);
  const [filterDropdown, setFilterDropdown] = useState(false);

  // Lazy real-size cache. Only populated for non-mock assets via
  // MediaLibrary.getAssetInfoAsync — the chip falls back to the
  // dimension-based estimate while the real value is being fetched.
  const [realSizes, setRealSizes] = useState<Record<string, number>>({});

  const flatListRef = useRef<FlatList>(null);
  const prevFilter = useRef(filter);
  const prevSort = useRef(sortBySize);
  const prevHide = useRef(hideReviewed);

  // Captured set of items considered "reviewed" at the moment Hide-Liked
  // was switched on. Stable so newly-reviewed items don't visibly disappear
  // mid-swipe.
  const hiddenSnapshotRef = useRef<Set<string> | null>(null);

  // Becomes true once the user has actually swiped a card in this session.
  // Until that flips, we don't auto-redirect on end-of-stack — that prevents
  // bouncing the user back out of a fully-reviewed month they entered on
  // purpose.
  const hasSwipedRef = useRef(false);

  const {
    keptItems, pendingDeletion, keepItem,
    markForDeletion, unswipeItem, allAssets,
  } = useMediaStore();

  /* ── filtered + sorted list ─────────────────────────────────────────── */
  const assets = useMemo<MediaLibrary.Asset[]>(() => {
    let list = allAssets.filter(a => {
      const d = new Date(a.creationTime);
      const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
      return key === monthKey;
    });

    if (filter === 'images') list = list.filter(a => a.mediaType === MediaLibrary.MediaType.photo);
    else if (filter === 'videos') list = list.filter(a => a.mediaType === MediaLibrary.MediaType.video);

    if (hideReviewed && hiddenSnapshotRef.current) {
      const hidden = hiddenSnapshotRef.current;
      list = list.filter(a => !hidden.has(a.id));
    }

    if (sortBySize) {
      // Sort by dimension-based estimate only — never by realSizes.
      // Including realSizes in deps would re-sort the list every time a
      // size loads asynchronously, which shifts indices and causes the
      // "next card doesn't appear" bug. The size chip still shows the
      // real value independently via realSizes[currentAsset.id].
      list = [...list].sort((a, b) => estimateAssetBytes(b) - estimateAssetBytes(a));
    }
    return list;
  }, [allAssets, monthKey, filter, sortBySize, hideReviewed]);

  const pendingIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pendingDeletion) s.add(p.id);
    return s;
  }, [pendingDeletion]);

  /* ── cursor placement helpers ───────────────────────────────────────── */
  const firstUnreviewedIdx = useCallback((list: MediaLibrary.Asset[]) => {
    const i = list.findIndex(a => !keptItems[a.id] && !pendingIds.has(a.id));
    return i === -1 ? 0 : i;
  }, [keptItems, pendingIds]);

  // First mount: drop the user on the first unreviewed card so they
  // don't land on something they've already decided.
  const didInitialPlacementRef = useRef(false);
  useEffect(() => {
    if (didInitialPlacementRef.current) return;
    if (assets.length === 0) return;
    didInitialPlacementRef.current = true;
    const idx = firstUnreviewedIdx(assets);
    if (idx !== 0) setCurrentIndex(idx);
  }, [assets, firstUnreviewedIdx]);

  // Filter / sort / hide changes: jump to first unreviewed in the new list.
  useEffect(() => {
    if (
      prevFilter.current !== filter ||
      prevSort.current !== sortBySize ||
      prevHide.current !== hideReviewed
    ) {
      setCurrentIndex(firstUnreviewedIdx(assets));
      prevFilter.current = filter;
      prevSort.current = sortBySize;
      prevHide.current = hideReviewed;
    }
  }, [filter, sortBySize, hideReviewed, assets, firstUnreviewedIdx]);

  /* ── auto-scroll up-next carousel to the active card ─────────────── */
  useEffect(() => {
    if (assets.length > 0 && currentIndex < assets.length && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: currentIndex, animated: true, viewPosition: 0.5,
      });
    }
  }, [currentIndex, assets.length]);

  /* ── stable refs for the pan handler closure ─────────────────────── */
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  /* ── auto-redirect when the user *actively* finishes the stack ──
   * Gated by hasSwipedRef so entering a fully-reviewed month doesn't
   * immediately bounce the user back. */
  useEffect(() => {
    if (!hasSwipedRef.current) return;
    if (currentIndex > 0 && assets.length > 0 && currentIndex >= assets.length) {
      if (pendingDeletion.length > 0) navigation.replace('Trash', { monthKey });
      else navigation.goBack();
    }
  }, [assets.length, currentIndex, pendingDeletion.length, navigation, monthKey]);

  /* ── swipe animation (transform-only -> native driver = 60fps) ── */
  const position = useRef(new Animated.ValueXY()).current;

  const forceSwipe = (direction: 'right' | 'left') => {
    const x = direction === 'right' ? SCREEN_WIDTH + 100 : -SCREEN_WIDTH - 100;
    Animated.timing(position, { toValue: { x, y: 0 }, duration: 220, useNativeDriver: true })
      .start(() => onSwipeComplete(direction));
  };

  const resetPosition = () => {
    Animated.spring(position, { toValue: { x: 0, y: 0 }, friction: 5, useNativeDriver: true }).start();
  };

  const onSwipeComplete = (direction: 'right' | 'left') => {
    const list = assetsRef.current;
    const idx = currentIndexRef.current;
    if (!list.length || idx >= list.length) return;
    const item = list[idx];
    if (!item) return;
    const pa: PendingAsset = {
      id: item.id, uri: item.uri, mediaType: item.mediaType,
      width: item.width, height: item.height, duration: item.duration,
    };
    if (direction === 'right') keepItem(pa); else markForDeletion(pa);
    hasSwipedRef.current = true;
    position.setValue({ x: 0, y: 0 });
    setCurrentIndex(p => p + 1);
  };

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_, g) => { position.setValue({ x: g.dx, y: g.dy }); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > SWIPE_THRESHOLD) forceSwipe('right');
      else if (g.dx < -SWIPE_THRESHOLD) forceSwipe('left');
      else resetPosition();
    },
  })).current;

  const getCardStyle = () => {
    const rotate = position.x.interpolate({
      inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
      outputRange: ['-15deg', '0deg', '15deg'],
      extrapolate: 'clamp',
    });
    return { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] };
  };

  /* ── KEEP / TRASH animated stickers (drag-driven) ─────────────────── */
  const renderStickers = () => {
    const keepOp = position.x.interpolate({ inputRange: [0, 60], outputRange: [0, 1], extrapolate: 'clamp' });
    const trashOp = position.x.interpolate({ inputRange: [-60, 0], outputRange: [1, 0], extrapolate: 'clamp' });
    return (
      <>
        <Animated.View style={[styles.stickerKeep, { opacity: keepOp }]}>
          <Text style={styles.stickerText}>KEEP</Text>
        </Animated.View>
        <Animated.View style={[styles.stickerTrash, { opacity: trashOp }]}>
          <Text style={styles.stickerText}>TRASH</Text>
        </Animated.View>
      </>
    );
  };

  /* ── shared video player ──
   * One ExoPlayer for the whole screen — replace its source via
   * `replaceAsync` when the active video changes, instead of paying
   * the codec cold-start cost on every swipe. */
  const videoPlayer = useVideoPlayer(null as any, p => { p.loop = true; p.muted = false; });

  const currentAsset: MediaLibrary.Asset | undefined = assets[currentIndex];
  const currentIsVideo = currentAsset?.mediaType === MediaLibrary.MediaType.video;

  useEffect(() => {
    if (!videoPlayer) return;
    if (currentIsVideo && currentAsset?.uri) {
      const p: any = videoPlayer;
      try {
        if (typeof p.replaceAsync === 'function') p.replaceAsync(currentAsset.uri);
        else if (typeof p.replace === 'function') p.replace(currentAsset.uri);
        videoPlayer.play();
      } catch (e) {
        console.warn('video player swap failed', e);
      }
    } else {
      try { videoPlayer.pause(); } catch {}
    }
  }, [currentIsVideo, currentAsset?.uri, videoPlayer]);

  /* ── prefetch upcoming photo cards ──
   * Warm expo-image's disk cache for the next few cards so swipes
   * transition cleanly instead of showing a blank card while the
   * next image decodes. */
  useEffect(() => {
    const targets: string[] = [];
    for (let i = currentIndex + 1; i <= currentIndex + PRELOAD_AHEAD && i < assets.length; i++) {
      const a = assets[i];
      if (a.mediaType === MediaLibrary.MediaType.photo) targets.push(a.uri);
    }
    if (targets.length) {
      Image.prefetch(targets, 'memory-disk');
    }
  }, [currentIndex, assets]);

  /* ── lazy real-size lookup for the current card ───────────────────── */
  useEffect(() => {
    if (!currentAsset) return;
    if (realSizes[currentAsset.id] !== undefined) return;
    let cancelled = false;
    fetchRealAssetSize(currentAsset).then(bytes => {
      if (cancelled || !bytes) return;
      setRealSizes(prev => ({ ...prev, [currentAsset.id]: bytes }));
    });
    return () => { cancelled = true; };
    // Only re-run when the *id* changes, not when the cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAsset?.id]);

  const renderMedia = (asset: MediaLibrary.Asset, active: boolean) => {
    if (asset.mediaType === MediaLibrary.MediaType.video) {
      if (!active) {
        return (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam-outline" size={56} color="#475569" />
            <Text style={styles.videoPlaceholderText}>Video</Text>
          </View>
        );
      }
      return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <VideoView
            player={videoPlayer}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
          />
        </View>
      );
    }
    return (
      <Image
        source={asset.uri}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        recyclingKey={asset.id}
      />
    );
  };

  /* ── filter dropdown actions ──────────────────────────────────────── */
  const enableHideReviewed = () => {
    const s = new Set<string>(Object.keys(keptItems));
    hiddenSnapshotRef.current = s;
    setHideReviewed(true);
    setFilterDropdown(false);
  };

  const disableHideReviewed = () => {
    hiddenSnapshotRef.current = null;
    setHideReviewed(false);
    setFilterDropdown(false);
  };

  /* ── un-swipe the currently shown card ────────────────────────────── */
  const handleUndo = () => {
    const current = assets[currentIndex];
    if (!current) return;
    const isReviewed = !!keptItems[current.id] || pendingIds.has(current.id);
    if (isReviewed) unswipeItem(current.id);
  };

  /* ── carousel item ────────────────────────────────────────────────── */
  const renderCarouselItem = useCallback(({ item, index: i }: { item: MediaLibrary.Asset; index: number }) => {
    const isCurrent = i === currentIndex;
    const isKept = !!keptItems[item.id];
    const isTrashed = pendingIds.has(item.id);
    const isVideo = item.mediaType === MediaLibrary.MediaType.video;

    return (
      <TouchableOpacity
        onPress={() => setCurrentIndex(i)}
        activeOpacity={0.8}
        style={[styles.carouselItem, isCurrent && styles.carouselItemActive, (isKept || isTrashed) && { opacity: 0.65 }]}
      >
        <Image
          source={item.uri}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={item.id}
        />
        {isTrashed && (
          <View style={[styles.carouselBadge, { backgroundColor: '#F87171' }]}>
            <Ionicons name="trash-outline" size={9} color="#0F172A" />
          </View>
        )}
        {isKept && !isTrashed && (
          <View style={[styles.carouselBadge, { backgroundColor: '#4ADE80' }]}>
            <Ionicons name="checkmark" size={9} color="#0F172A" />
          </View>
        )}
        {isVideo && !isKept && !isTrashed && (
          <View style={[styles.carouselBadge, { backgroundColor: '#A78BFA' }]}>
            <Ionicons name="play" size={9} color="#0F172A" />
          </View>
        )}
      </TouchableOpacity>
    );
  }, [currentIndex, keptItems, pendingIds]);

  /* ── derived state for the render ─────────────────────────────────── */

  // Done screen *only* when the filtered list is genuinely empty. If the
  // user has reviewed everything but is in "Show All" mode, we keep the
  // swipe stack visible so they can re-swipe or undo any decision —
  // that's the whole point of "Show All".
  const showDoneScreen = assets.length === 0;
  const isHideReviewedEmpty = assets.length === 0 && hideReviewed;

  const reviewedInList = useMemo(() => {
    let n = 0;
    for (const a of assets) if (keptItems[a.id] || pendingIds.has(a.id)) n++;
    return n;
  }, [assets, keptItems, pendingIds]);
  const allReviewed = assets.length > 0 && reviewedInList === assets.length;

  // Real bytes if cached, else the dimension estimate. The chip leads
  // with `~` while it's still an estimate and drops it once the real
  // size lands.
  const fileSizeBytes = currentAsset
    ? realSizes[currentAsset.id] ?? estimateAssetBytes(currentAsset)
    : 0;
  const fileSizeIsReal = !!currentAsset && realSizes[currentAsset.id] != null;
  const fileSizeLabel = !showDoneScreen && currentAsset && fileSizeBytes > 0
    ? `${fileSizeIsReal ? '' : '~'}${formatBytes(fileSizeBytes)}`
    : null;

  const currentCardKept = !!currentAsset && !!keptItems[currentAsset.id];
  const currentCardTrashed = !!currentAsset && pendingIds.has(currentAsset.id);
  const currentCardReviewed = currentCardKept || currentCardTrashed;

  /* ── render ───────────────────────────────────────────────────────── */
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#0F172A" />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>{monthKey}</Text>

        {!showDoneScreen ? (
          <TouchableOpacity
            style={[styles.iconBtn, currentCardReviewed && { backgroundColor: '#FDE047' }]}
            onPress={handleUndo}
            disabled={!currentCardReviewed}
          >
            <Ionicons
              name="arrow-undo"
              size={20}
              color="#0F172A"
              style={{ opacity: currentCardReviewed ? 1 : 0.3 }}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {/* CONTROL BAR — always visible */}
      <View style={styles.controlBar}>
        <TouchableOpacity
          style={styles.controlPill}
          onPress={() => { setSortDropdown(v => !v); setFilterDropdown(false); }}
        >
          <Ionicons name="funnel-outline" size={13} color="#FDE047" />
          <Text style={styles.controlPillText}>{sortBySize ? 'Biggest First' : 'By Date'}</Text>
          <Ionicons name="chevron-down" size={13} color="#FDE047" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlPill, styles.controlPillLight, hideReviewed && styles.controlPillLightActive]}
          onPress={() => { setFilterDropdown(v => !v); setSortDropdown(false); }}
        >
          <Ionicons name={hideReviewed ? 'eye-off-outline' : 'eye-outline'} size={13} color="#0F172A" />
          <Text style={styles.controlPillTextDark}>{hideReviewed ? 'Hide Liked' : 'Show All'}</Text>
          <Ionicons name="chevron-down" size={13} color="#0F172A" />
        </TouchableOpacity>
      </View>

      {/* SORT DROPDOWN */}
      <Modal transparent visible={sortDropdown} onRequestClose={() => setSortDropdown(false)} animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setSortDropdown(false)}>
          <View style={styles.dropdown}>
            {(['Biggest First', 'By Date'] as const).map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.dropdownItem, sortBySize === (opt === 'Biggest First') && styles.dropdownItemActive]}
                onPress={() => { setSortBySize(opt === 'Biggest First'); setSortDropdown(false); }}
              >
                <Text style={[styles.dropdownText, sortBySize === (opt === 'Biggest First') && styles.dropdownTextActive]}>
                  {opt}
                </Text>
                {sortBySize === (opt === 'Biggest First') && <Ionicons name="checkmark" size={16} color="#0F172A" />}
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* FILTER DROPDOWN */}
      <Modal transparent visible={filterDropdown} onRequestClose={() => setFilterDropdown(false)} animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setFilterDropdown(false)}>
          <View style={[styles.dropdown, { left: undefined, right: 18, alignSelf: undefined }]}>
            <TouchableOpacity
              style={[styles.dropdownItem, !hideReviewed && styles.dropdownItemActive]}
              onPress={disableHideReviewed}
            >
              <Text style={[styles.dropdownText, !hideReviewed && styles.dropdownTextActive]}>Show All</Text>
              {!hideReviewed && <Ionicons name="checkmark" size={16} color="#0F172A" />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dropdownItem, hideReviewed && styles.dropdownItemActive]}
              onPress={enableHideReviewed}
            >
              <Text style={[styles.dropdownText, hideReviewed && styles.dropdownTextActive]}>Hide Liked</Text>
              {hideReviewed && <Ionicons name="checkmark" size={16} color="#0F172A" />}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* DONE PANE — only when the filtered list is truly empty */}
      {showDoneScreen && (
        <View style={styles.donePane}>
          <Ionicons
            name={isHideReviewedEmpty ? 'checkmark-done-circle-outline' : 'images-outline'}
            size={72}
            color="#0F172A"
          />
          <Text style={styles.doneTitle}>
            {isHideReviewedEmpty ? 'All caught up' : 'Nothing here'}
          </Text>
          <Text style={styles.doneBody}>
            {isHideReviewedEmpty
              ? 'Every photo in this month is liked, so it is hidden. Use the filter above to show them again.'
              : 'No media in this month matches the current filter.'}
          </Text>
          <View style={styles.doneActions}>
            {pendingDeletion.length > 0 && (
              <TouchableOpacity
                style={[styles.controlPill, { backgroundColor: '#F87171' }]}
                onPress={() => navigation.replace('Trash', { monthKey })}
              >
                <Ionicons name="trash-outline" size={13} color="#0F172A" />
                <Text style={styles.controlPillTextDark}>
                  Review {pendingDeletion.length} to delete
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.controlPill} onPress={() => navigation.goBack()}>
              <Text style={styles.controlPillText}>Back to months</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* SWIPE UI */}
      {!showDoneScreen && (
        <>
          {/* Inline banner so the user understands why every visible card
              looks "decided" already, and that they can still re-swipe. */}
          {allReviewed && (
            <View style={styles.allDoneBanner}>
              <Ionicons name="checkmark-done" size={14} color="#0F172A" />
              <Text style={styles.allDoneBannerText}>
                All reviewed — swipe again to change a decision, or tap undo.
              </Text>
            </View>
          )}

          {/* Card stack */}
          <View style={styles.cardContainer}>
            {assets[currentIndex + 1] && (
              <Animated.View key={assets[currentIndex + 1].id} style={[styles.card, styles.cardBehind]}>
                {renderMedia(assets[currentIndex + 1], false)}
              </Animated.View>
            )}
            {currentAsset && (
              <Animated.View
                key={currentAsset.id}
                style={[styles.card, getCardStyle()]}
                {...panResponder.panHandlers}
              >
                {renderMedia(currentAsset, true)}
                {renderStickers()}

                {/* Reviewed badge — top-right corner, mirrors the action that already happened */}
                {currentCardReviewed && (
                  <View style={[
                    styles.reviewedBadge,
                    { backgroundColor: currentCardKept ? '#4ADE80' : '#F87171' },
                  ]}>
                    <Ionicons
                      name={currentCardKept ? 'heart' : 'trash'}
                      size={11}
                      color="#0F172A"
                    />
                    <Text style={styles.reviewedBadgeText}>
                      {currentCardKept ? 'KEPT' : 'TRASHED'}
                    </Text>
                  </View>
                )}

                {fileSizeLabel && (
                  <View style={styles.sizeChip}>
                    <Text style={styles.sizeChipText}>{fileSizeLabel}</Text>
                  </View>
                )}
              </Animated.View>
            )}
          </View>

          {/* Up-next carousel */}
          <View style={styles.carouselSection}>
            <Text style={styles.carouselLabel}>
              {Math.min(currentIndex + 1, assets.length)} / {assets.length} · {reviewedInList} REVIEWED
            </Text>
            <FlatList
              ref={flatListRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              data={assets}
              keyExtractor={item => item.id}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              onScrollToIndexFailed={info => {
                setTimeout(() => flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 500);
              }}
              renderItem={renderCarouselItem}
              getItemLayout={(_, index) => ({ length: 68, offset: 68 * index, index })}
              initialNumToRender={8}
              maxToRenderPerBatch={6}
              windowSize={5}
              removeClippedSubviews
            />
          </View>

          {/* Action buttons — Keep/Trash highlight when current card already
              has that decision, so users see at-a-glance state. */}
          <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionTrash, currentCardTrashed && styles.actionBtnActive]}
              onPress={() => forceSwipe('left')}
            >
              <Ionicons name="trash-outline" size={28} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionSkip]}
              onPress={() => setCurrentIndex(p => Math.min(p + 1, assets.length - 1))}
            >
              <Ionicons name="play-forward" size={22} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionKeep, currentCardKept && styles.actionBtnActive]}
              onPress={() => forceSwipe('right')}
            >
              <Ionicons name="heart-outline" size={30} color="#0F172A" />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#A78BFA' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '3px 3px 0px 0px #0F172A',
  },
  headerTitle: { fontSize: 20, fontWeight: '900', color: '#0F172A', flex: 1, textAlign: 'center', marginHorizontal: 8 },

  /* Control bar */
  controlBar: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 8 },
  controlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0F172A',
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  controlPillText: { color: '#FDE047', fontSize: 12, fontWeight: '800' },
  controlPillLight: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0F172A',
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  controlPillLightActive: { backgroundColor: '#4ADE80' },
  controlPillTextDark: { color: '#0F172A', fontSize: 12, fontWeight: '800' },

  /* Dropdown */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  dropdown: {
    position: 'absolute',
    top: 130,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#0F172A',
    overflow: 'hidden',
    boxShadow: '4px 4px 0px 0px #0F172A',
    minWidth: 180,
  },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  dropdownItemActive: { backgroundColor: '#FDE047' },
  dropdownText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  dropdownTextActive: { fontWeight: '900' },

  /* All-reviewed banner */
  allDoneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: '#FDE047',
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 4,
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  allDoneBannerText: { fontSize: 11, fontWeight: '800', color: '#0F172A' },

  /* Done pane */
  donePane: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneTitle: { fontSize: 20, fontWeight: '900', color: '#0F172A', marginTop: 16, textAlign: 'center' },
  doneBody: { color: '#0F172A', fontWeight: '600', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  doneActions: { flexDirection: 'row', gap: 10, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' },

  /* Card */
  cardContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: '96%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 4,
    borderColor: '#0F172A',
    overflow: 'hidden',
    boxShadow: '8px 8px 0px 0px #0F172A',
  },
  cardBehind: {
    transform: [{ scale: 0.95 }],
    top: 12,
    zIndex: -1,
    shadowOffset: { width: 4, height: 4 },
  },
  videoPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#E2E8F0' },
  videoPlaceholderText: { color: '#475569', marginTop: 8, fontWeight: '700' },

  /* Stickers (drag-driven) */
  stickerKeep: {
    position: 'absolute',
    top: 30,
    left: -14,
    backgroundColor: '#4ADE80',
    borderWidth: 4,
    borderColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    transform: [{ rotate: '-12deg' }],
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  stickerTrash: {
    position: 'absolute',
    top: 30,
    right: -14,
    backgroundColor: '#F87171',
    borderWidth: 4,
    borderColor: '#0F172A',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    transform: [{ rotate: '12deg' }],
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  stickerText: { fontSize: 26, fontWeight: '900', color: '#0F172A', letterSpacing: 2 },

  /* Reviewed badge (current decision, top-right) */
  reviewedBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  reviewedBadgeText: { fontSize: 11, fontWeight: '900', color: '#0F172A', letterSpacing: 0.5 },

  /* Size chip (bottom-left) */
  sizeChip: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    backgroundColor: '#FDE047',
    borderWidth: 2,
    borderColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  sizeChipText: { fontSize: 12, fontWeight: '800', color: '#0F172A' },

  /* Carousel */
  carouselSection: { gap: 6, paddingTop: 10, paddingBottom: 6 },
  carouselLabel: { textAlign: 'center', fontSize: 11, fontWeight: '800', color: '#0F172A', letterSpacing: 0.5 },
  carouselItem: {
    width: 58,
    height: 58,
    borderRadius: 11,
    borderWidth: 2.5,
    borderColor: '#0F172A',
    marginRight: 10,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    position: 'relative',
  },
  carouselItemActive: {
    width: 74,
    height: 74,
    borderWidth: 4,
    borderColor: '#FDE047',
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  carouselBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Action buttons */
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingTop: 8,
  },
  actionBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 99,
    borderWidth: 4,
    borderColor: '#0F172A',
    boxShadow: '5px 5px 0px 0px #0F172A',
  },
  actionBtnActive: {
    borderWidth: 6,
    borderColor: '#FFFFFF',
  },
  actionTrash: { width: 68, height: 68, backgroundColor: '#F87171' },
  actionSkip: { width: 50, height: 50, backgroundColor: '#FFFFFF' },
  actionKeep: { width: 68, height: 68, backgroundColor: '#4ADE80' },
});
