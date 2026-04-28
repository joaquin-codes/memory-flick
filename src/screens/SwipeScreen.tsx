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
import { estimateAssetBytes, formatBytes } from '../utils/mediaLibrary';
import { useMediaStore, PendingAsset } from '../store/useMediaStore';
import * as MediaLibrary from 'expo-media-library';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 120;
const CARD_W = SCREEN_WIDTH - 48;   // 24 margin each side

type Props = NativeStackScreenProps<RootStackParamList, 'Swipe'>;

export default function SwipeScreen({ route, navigation }: Props) {
  const { monthKey, filter } = route.params;
  const insets = useSafeAreaInsets();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortBySize, setSortBySize] = useState(true);
  const [hideReviewed, setHideReviewed] = useState(false);
  const [sortDropdown, setSortDropdown] = useState(false);
  const [filterDropdown, setFilterDropdown] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const prevFilter = useRef(filter);
  const prevSort = useRef(sortBySize);
  const prevHide = useRef(hideReviewed);
  // Captured set of items considered "reviewed" at the moment Hide-Reviewed
  // was switched on. We deliberately keep this snapshot stable so newly
  // reviewed items in the current session aren't yanked out from under
  // the user mid-swipe (which would visibly skip cards).
  const hiddenSnapshotRef = useRef<Set<string> | null>(null);

  const {
    keptItems, pendingDeletion, keepItem,
    markForDeletion, unswipeItem, allAssets,
  } = useMediaStore();

  // Build the list directly via filter (no full month-grouping) and use a
  // proper byte-estimate for sort. Memoised so renders during a swipe
  // don't re-sort the whole month.
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
      list = [...list].sort((a, b) => estimateAssetBytes(b) - estimateAssetBytes(a));
    }
    return list;
  }, [allAssets, monthKey, filter, sortBySize, hideReviewed]);

  // O(1) lookups for kept/pending — used by carousel + card overlays.
  const pendingIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pendingDeletion) s.add(p.id);
    return s;
  }, [pendingDeletion]);

  // Reset cursor when filter/sort/hide actually changes.
  useEffect(() => {
    if (
      prevFilter.current !== filter ||
      prevSort.current !== sortBySize ||
      prevHide.current !== hideReviewed
    ) {
      setCurrentIndex(0);
      prevFilter.current = filter;
      prevSort.current = sortBySize;
      prevHide.current = hideReviewed;
    }
  }, [filter, sortBySize, hideReviewed]);

  /* ── auto-scroll carousel ── */
  useEffect(() => {
    if (assets.length > 0 && currentIndex < assets.length && flatListRef.current) {
      flatListRef.current.scrollToIndex({
        index: currentIndex, animated: true, viewPosition: 0.5,
      });
    }
  }, [currentIndex, assets.length]);

  /* ── keep refs fresh for pan handler ── */
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  const assetsRef = useRef(assets);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  /* ── auto-redirect when the user finishes the stack ──
   * Only fires when the user actually walked the cards to the end
   * (currentIndex > 0). The empty-state (e.g. all reviewed + Hide
   * Reviewed on) is handled by an explicit UI below — never as a
   * silent navigation away — and never as an infinite spinner. */
  useEffect(() => {
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
    const pa: PendingAsset = { id: item.id, uri: item.uri, mediaType: item.mediaType, width: item.width, height: item.height, duration: item.duration };
    if (direction === 'right') keepItem(pa); else markForDeletion(pa);
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

  /* ── KEEP / TRASH overlay stickers ── */
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
   * The previous implementation created a brand new ExoPlayer (Android)
   * every time the active card became a video, which is what made
   * "Videos take too long to load" — every swipe paid the decoder
   * cold-start cost. We now keep one player alive for the screen and
   * swap its source via `replaceAsync` when the current video changes.
   * Photos pause the player; videos play it. */
  const videoPlayer = useVideoPlayer(null as any, p => { p.loop = true; p.muted = false; });

  const currentAsset: MediaLibrary.Asset | undefined = assets[currentIndex];
  const currentIsVideo = currentAsset?.mediaType === MediaLibrary.MediaType.video;

  useEffect(() => {
    if (!videoPlayer) return;
    if (currentIsVideo && currentAsset?.uri) {
      // replaceAsync keeps the codec / surface warm between videos.
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

  /* ── toggle hide reviewed ──
   * "Hide Liked" hides items the user kept (keptItems only).
   * Disliked/pending-deletion items stay visible so the user can
   * still see and reconsider trash picks. */
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

  /* ── un-swipe the currently shown card ──
   * Removes its liked OR disliked status so it becomes "unreviewed"
   * again. Works regardless of whether it was the most recent swipe. */
  const handleUndo = () => {
    const current = assets[currentIndex];
    if (!current) return;
    const isReviewed = !!keptItems[current.id] || pendingIds.has(current.id);
    if (isReviewed) unswipeItem(current.id);
  };

  /* ── carousel item ── */
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

  // True when every asset in the filtered list has already been reviewed.
  // Shown as a "done" screen rather than a blank swipe stack.
  const allDone = assets.length > 0 && assets.every(a => !!keptItems[a.id] || pendingIds.has(a.id));
  const showDoneScreen = assets.length === 0 || allDone;

  const isDoneState = allDone;
  const isHideReviewedEmpty = assets.length === 0 && hideReviewed;

  const fileSizeLabel = !showDoneScreen && currentAsset
    ? `~${formatBytes(estimateAssetBytes(currentAsset))}`
    : null;

  const currentCardReviewed = !!currentAsset && (!!keptItems[currentAsset.id] || pendingIds.has(currentAsset.id));

  // Single unified return — the control bar and both dropdowns are always
  // in the tree so the filter is accessible even from the done screen.
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#0F172A" />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>{monthKey}</Text>

        {/* Undo button: only meaningful in swipe mode */}
        {!showDoneScreen ? (
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: '#FDE047' }]}
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

      {/* ── CONTROL BAR — always visible ── */}
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

      {/* ── SORT DROPDOWN ── */}
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

      {/* ── FILTER DROPDOWN ── */}
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

      {/* ── DONE SCREEN (inline, not an early return) ── */}
      {showDoneScreen && (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons
            name={isDoneState || isHideReviewedEmpty ? 'checkmark-done-circle-outline' : 'images-outline'}
            size={72}
            color="#0F172A"
          />
          <Text style={[styles.headerTitle, { marginTop: 16, textAlign: 'center' }]}>
            {isDoneState || isHideReviewedEmpty ? 'All swiped!' : 'Nothing here'}
          </Text>
          <Text style={{ color: '#0F172A', fontWeight: '600', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {isDoneState
              ? "You've gone through every photo and video in this month."
              : isHideReviewedEmpty
                ? 'All liked photos are hidden — use the filter above to show them.'
                : 'No media in this month matches the current filter.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
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

      {/* ── SWIPE UI (card stack + carousel + buttons) ── */}
      {!showDoneScreen && (
        <>
          {/* Card stack — only ever 2 cards in the tree */}
          <View style={styles.cardContainer}>
            {assets[currentIndex + 1] && (
              <Animated.View key={assets[currentIndex + 1].id} style={[styles.card, styles.cardBehind]}>
                {renderMedia(assets[currentIndex + 1], false)}
              </Animated.View>
            )}
            {currentAsset && (
              <Animated.View key={currentAsset.id} style={[styles.card, getCardStyle()]} {...panResponder.panHandlers}>
                {renderMedia(currentAsset, true)}
                {renderStickers()}
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
              UP NEXT · {currentIndex + 1} / {assets.length}
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

          {/* Action buttons */}
          <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionTrash]} onPress={() => forceSwipe('left')}>
              <Ionicons name="trash-outline" size={28} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionSkip]}
              onPress={() => setCurrentIndex(p => Math.min(p + 1, assets.length - 1))}
            >
              <Ionicons name="play-forward" size={22} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionKeep]} onPress={() => forceSwipe('right')}>
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

  /* Stickers */
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

  /* Size chip */
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
  carouselLabel: { textAlign: 'center', fontSize: 12, fontWeight: '800', color: '#0F172A', letterSpacing: 0.5 },
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
  actionTrash: { width: 68, height: 68, backgroundColor: '#F87171' },
  actionSkip: { width: 50, height: 50, backgroundColor: '#FFFFFF' },
  actionKeep: { width: 68, height: 68, backgroundColor: '#4ADE80' },
});
