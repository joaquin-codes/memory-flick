import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RootStackParamList } from '../navigation/types';
import { requestMediaPermissions, fetchAllMedia, groupAssetsByMonth, MonthGroup } from '../utils/mediaLibrary';
import { useMediaStore } from '../store/useMediaStore';
import * as MediaLibrary from 'expo-media-library';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type FilterType = 'all' | 'images' | 'videos';

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [mediaGroups, setMediaGroups] = useState<MonthGroup[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { keptItems, pendingDeletion, totalSpaceSavedBytes } = useMediaStore();

  const loadMedia = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const granted = await requestMediaPermissions();
      setHasPermission(granted);

      if (granted) {
        const assets = await fetchAllMedia();
        const groups = groupAssetsByMonth(assets);
        setMediaGroups(groups);
      }
    } catch (err: any) {
      console.warn(err);
      setErrorMsg(err.message || "Failed to load media.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMedia();
  }, []);

  const totalPending = pendingDeletion.length;

  const renderGroup = useCallback(({ item: group }: { item: MonthGroup }) => {
    let filteredAssets = group.assets;
    if (filter === 'images') {
      filteredAssets = filteredAssets.filter(a => a.mediaType === MediaLibrary.MediaType.photo);
    } else if (filter === 'videos') {
      filteredAssets = filteredAssets.filter(a => a.mediaType === MediaLibrary.MediaType.video);
    }

    if (filteredAssets.length === 0) return null;

    // Calculate progress
    const processedCount = filteredAssets.filter(
      a => keptItems[a.id] || pendingDeletion.some(p => p.id === a.id)
    ).length;
    
    const progress = processedCount / filteredAssets.length;
    const isCompleted = progress >= 1;

    return (
      <TouchableOpacity 
        style={[styles.card, isCompleted && styles.cardCompleted]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Swipe', { monthKey: group.key, filter })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{group.title}</Text>
          {isCompleted && <Ionicons name="checkmark-circle" size={24} color="#4ade80" />}
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.cardStat}>
            {processedCount} / {filteredAssets.length} Reviewed
          </Text>
          <Text style={styles.cardAction}>
            {isCompleted ? 'Review Again' : 'Start Swiping'} <Ionicons name="arrow-forward" size={14} />
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [filter, keptItems, pendingDeletion, navigation]);

  const FilterButton = ({ type, label }: { type: FilterType, label: string }) => (
    <TouchableOpacity 
      style={[styles.filterButton, filter === type && styles.filterButtonActive]}
      onPress={() => setFilter(type)}
    >
      <Text style={[styles.filterText, filter === type && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={styles.loadingText}>Fetching memories...</Text>
      </View>
    );
  }

  if (!hasPermission || errorMsg) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="warning-outline" size={48} color="#ef4444" style={{marginBottom: 16}} />
        <Text style={styles.errorText}>
          {errorMsg ? `Error: ${errorMsg}\n\nNote: Expo Go limits Media Library access. You may need a Development Build.` : `We need permission to access your media to help you clean it up.`}
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={loadMedia}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Memory Flick</Text>
          <Text style={styles.subtitle}>
            {(totalSpaceSavedBytes / (1024 * 1024)).toFixed(2)} MB Saved
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.trashButton}
          onPress={() => navigation.navigate('Trash', {})}
        >
          <Ionicons name="trash-outline" size={24} color="#ef4444" />
          {totalPending > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{totalPending}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <FilterButton type="all" label="All" />
        <FilterButton type="images" label="Images" />
        <FilterButton type="videos" label="Videos" />
      </View>

      <FlatList
        data={mediaGroups}
        keyExtractor={item => item.key}
        renderItem={renderGroup}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Slate 900
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#4ade80',
    fontWeight: '600',
    marginTop: 4,
  },
  loadingText: {
    marginTop: 16,
    color: '#94a3b8',
    fontSize: 16,
  },
  errorText: {
    color: '#f8fafc',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  primaryButton: {
    backgroundColor: '#a855f7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 99,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  trashButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0f172a',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#1e293b',
  },
  filterButtonActive: {
    backgroundColor: '#a855f7',
  },
  filterText: {
    color: '#94a3b8',
    fontWeight: '600',
    fontSize: 14,
  },
  filterTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardCompleted: {
    borderColor: '#4ade80',
    backgroundColor: '#1e293b',
    opacity: 0.8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#a855f7',
    borderRadius: 3,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardStat: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  cardAction: {
    color: '#a855f7',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
