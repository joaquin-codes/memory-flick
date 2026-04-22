import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { RootStackParamList } from '../navigation/types';
import { requestMediaPermissions, fetchAllMedia, groupAssetsByMonth, MonthGroup } from '../utils/mediaLibrary';
import { useMediaStore } from '../store/useMediaStore';
import * as MediaLibrary from 'expo-media-library';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;
type FilterType = 'all' | 'images' | 'videos';

const CARD_WIDTH = (Dimensions.get('window').width - 20 * 2 - 14) / 2;

// Rotating accent colours for month card count badges
const BADGE_COLORS = ['#FDE047', '#A78BFA', '#4ADE80', '#F87171'];

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    keptItems, pendingDeletion, totalSpaceSavedBytes,
    allAssets, isFetchingMedia, mediaFetchProgress,
    setAllAssets, setFetchingMedia, setMediaFetchProgress
  } = useMediaStore();

  const mediaGroups = useMemo(() => groupAssetsByMonth(allAssets), [allAssets]);

  const loadMedia = async () => {
    if (allAssets.length > 0 && !isFetchingMedia) {
      setLoading(false);
      setHasPermission(true);
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const granted = await requestMediaPermissions();
      setHasPermission(granted);
      if (granted) {
        setLoading(false);
        setFetchingMedia(true);
        const assets = await fetchAllMedia((currentAssets, _hasNext, totalCount) => {
          setAllAssets(currentAssets);
          setMediaFetchProgress(currentAssets.length, totalCount);
        });
        setAllAssets(assets);
      }
    } catch (err: any) {
      console.warn(err);
      setErrorMsg(err.message || 'Failed to load media.');
    } finally {
      setLoading(false);
      setFetchingMedia(false);
    }
  };

  useEffect(() => { loadMedia(); }, []);

  const totalPending = pendingDeletion.length;
  const fetchPct = mediaFetchProgress.total > 0
    ? Math.min(1, mediaFetchProgress.loaded / mediaFetchProgress.total)
    : 0;

  const renderGroup = useCallback(({ item: group, index }: { item: MonthGroup; index: number }) => {
    let filteredAssets = group.assets;
    if (filter === 'images') filteredAssets = filteredAssets.filter(a => a.mediaType === MediaLibrary.MediaType.photo);
    else if (filter === 'videos') filteredAssets = filteredAssets.filter(a => a.mediaType === MediaLibrary.MediaType.video);
    if (filteredAssets.length === 0) return null;

    const firstAsset = filteredAssets[0];
    const videoCount = filteredAssets.filter(a => a.mediaType === MediaLibrary.MediaType.video).length;
    const badgeColor = BADGE_COLORS[index % BADGE_COLORS.length];

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('Swipe', { monthKey: group.key, filter })}
      >
        {/* Thumbnail */}
        <View style={styles.cardThumb}>
          <Image source={firstAsset.uri} style={styles.cardThumbImage} contentFit="cover" />
          {/* Count badge */}
          <View style={[styles.countBadge, { backgroundColor: badgeColor }]}>
            <Text style={styles.countBadgeText}>{filteredAssets.length}</Text>
          </View>
        </View>

        {/* Info */}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{group.title}</Text>
          {videoCount > 0 && (
            <Text style={styles.cardSub}>{videoCount} video{videoCount !== 1 ? 's' : ''}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [filter, navigation]);

  /* ── Loading ── */
  if (loading && allAssets.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#A78BFA" />
        <Text style={styles.loadingText}>Fetching memories…</Text>
      </View>
    );
  }

  /* ── Permission error ── */
  if (!hasPermission || errorMsg) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="warning-outline" size={48} color="#F87171" style={{ marginBottom: 16 }} />
        <Text style={styles.errorText}>
          {errorMsg
            ? `Error: ${errorMsg}\n\nNote: Expo Go limits Media Library access. You may need a Development Build.`
            : 'We need permission to access your media.'}
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={loadMedia}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Memory Flick</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            style={styles.trashButton}
            onPress={() => navigation.navigate('Trash', {})}
          >
            <Ionicons name="trash-outline" size={24} color="#0F172A" />
            {totalPending > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{totalPending}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.trashButton}>
            <Ionicons name="settings-outline" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Loading progress card ── */}
      {isFetchingMedia && mediaFetchProgress.total > 0 && (
        <View style={styles.progressCard}>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>Loading Memories…</Text>
            <Text style={styles.progressCount}>
              {mediaFetchProgress.loaded.toLocaleString()} / {mediaFetchProgress.total.toLocaleString()}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${fetchPct * 100}%` }]} />
          </View>
        </View>
      )}

      {/* ── Filter pills ── */}
      <View style={styles.filterRow}>
        {(['all', 'images', 'videos'] as FilterType[]).map(type => (
          <TouchableOpacity
            key={type}
            style={[styles.filterPill, filter === type && styles.filterPillActive]}
            onPress={() => setFilter(type)}
          >
            <Text style={[styles.filterText, filter === type && styles.filterTextActive]}>
              {type === 'all' ? 'All' : type === 'images' ? 'Images' : 'Videos'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Month grid ── */}
      <FlatList
        data={mediaGroups}
        keyExtractor={item => item.key}
        renderItem={renderGroup}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDE047' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },

  /* Header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
    opacity: 0.6,
  },
  trashButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '3px 3px 0px 0px #0F172A',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: '#F87171',
    borderRadius: 12,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0F172A',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#0F172A', fontSize: 10, fontWeight: '900' },

  /* Progress card */
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 3,
    borderColor: '#0F172A',
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  progressLabel: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  progressCount: { fontSize: 12, fontWeight: '600', color: '#475569' },
  progressTrack: {
    height: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#A78BFA',
    borderRadius: 99,
  },

  /* Filter */
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 14,
    gap: 8,
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 99,
    backgroundColor: 'rgba(15,23,42,0.08)',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterPillActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  filterText: { color: '#0F172A', fontWeight: '700', fontSize: 13 },
  filterTextActive: { color: '#FDE047' },

  /* Grid */
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  row: { justifyContent: 'space-between', marginBottom: 14 },

  card: {
    width: CARD_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#0F172A',
    overflow: 'hidden',
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  cardThumb: { height: 120, backgroundColor: '#E2E8F0', position: 'relative' },
  cardThumbImage: { width: '100%', height: '100%' },
  countBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  countBadgeText: { fontSize: 12, fontWeight: '900', color: '#0F172A' },
  cardInfo: { padding: 10 },
  cardTitle: { fontSize: 15, fontWeight: '900', color: '#0F172A' },
  cardSub: { fontSize: 12, fontWeight: '600', color: '#475569', marginTop: 3 },

  /* Misc */
  loadingText: { marginTop: 16, color: '#0F172A', fontSize: 15, fontWeight: '700' },
  errorText: { color: '#0F172A', fontSize: 15, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  primaryButton: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 99,
    borderWidth: 3,
    borderColor: '#0F172A',
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  primaryButtonText: { color: '#FDE047', fontWeight: '900', fontSize: 16 },
});
