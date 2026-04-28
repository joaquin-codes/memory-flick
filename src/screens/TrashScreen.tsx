import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';

import { RootStackParamList } from '../navigation/types';
import { useMediaStore } from '../store/useMediaStore';
import { estimateAssetBytes, formatBytes } from '../utils/mediaLibrary';

type Props = NativeStackScreenProps<RootStackParamList, 'Trash'>;

export default function TrashScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { pendingDeletion, confirmDeletion, incrementSpaceSaved, restoreItem } = useMediaStore();
  const [isDeleting, setIsDeleting] = useState(false);

  const estimateBytes = (assets: any[]): number => {
    let total = 0;
    for (const a of assets) total += estimateAssetBytes(a);
    return total;
  };

  const totalBytes = estimateBytes(pendingDeletion);
  const totalLabel = formatBytes(totalBytes);

  const handleDelete = async () => {
    if (!pendingDeletion.length) return;
    Alert.alert(
      'Delete Permanently?',
      `${pendingDeletion.length} item${pendingDeletion.length !== 1 ? 's' : ''} will be removed forever. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            const ids = pendingDeletion.map(a => a.id);
            try {
              const bytes = estimateBytes(pendingDeletion);
              const ok = await MediaLibrary.deleteAssetsAsync(ids);
              if (ok) {
                confirmDeletion(ids);
                incrementSpaceSaved(bytes);
                Alert.alert('Done!', `Freed up ~${formatBytes(bytes)}.`);
                navigation.goBack();
              }
            } catch (e) {
              console.error(e);
              Alert.alert('Error', 'Could not delete assets. Check permissions.');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.gridItem}>
      <Image
        source={item.uri}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        recyclingKey={item.id}
      />
      {item.mediaType === 'video' && (
        <View style={styles.videoIndicator}>
          <Ionicons name="play" size={10} color="#0F172A" />
        </View>
      )}
      <TouchableOpacity style={styles.restoreBtn} onPress={() => restoreItem(item.id)}>
        <Ionicons name="refresh-outline" size={16} color="#0F172A" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Pending Review</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* ── Stat pills ── */}
      {pendingDeletion.length > 0 && (
        <View style={styles.statRow}>
          <View style={[styles.statPill, { backgroundColor: '#F87171' }]}>
            <Text style={styles.statPillText}>{pendingDeletion.length} Items</Text>
          </View>
          <View style={[styles.statPill, { backgroundColor: '#FDE047' }]}>
            <Text style={styles.statPillText}>~{totalLabel} Freed</Text>
          </View>
        </View>
      )}

      {/* ── Content ── */}
      {pendingDeletion.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="layers-outline" size={40} color="#0F172A" />
          </View>
          <Text style={styles.emptyText}>Nothing here yet.</Text>
          <Text style={styles.emptySubText}>Swipe left on images to add them here.</Text>
        </View>
      ) : (
        <FlatList
          data={pendingDeletion}
          numColumns={3}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          initialNumToRender={9}
          maxToRenderPerBatch={9}
          windowSize={5}
          removeClippedSubviews
        />
      )}

      {/* ── Delete button ── */}
      {pendingDeletion.length > 0 && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom + 12, 28) }]}>
          <TouchableOpacity
            style={[styles.deleteBtn, isDeleting && { opacity: 0.7 }]}
            onPress={handleDelete}
            disabled={isDeleting}
            activeOpacity={0.85}
          >
            {isDeleting ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <Text style={styles.deleteBtnText}>DELETE PERMANENTLY</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const ITEM_SIZE = (StyleSheet.hairlineWidth, (() => {
  const { width } = require('react-native').Dimensions.get('window');
  return (width - 48) / 3;   // 3 cols, 16px gutter each side + between
})());

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#4ADE80' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  backBtn: {
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
  title: { fontSize: 22, fontWeight: '900', color: '#0F172A' },

  /* Stat pills */
  statRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  statPill: {
    borderRadius: 99,
    borderWidth: 2,
    borderColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 5,
    boxShadow: '2px 2px 0px 0px #0F172A',
  },
  statPillText: { fontSize: 13, fontWeight: '800', color: '#0F172A' },

  /* Grid */
  grid: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#0F172A',
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    margin: 4,
    position: 'relative',
    boxShadow: '3px 3px 0px 0px #0F172A',
  },
  videoIndicator: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 18,
    height: 18,
    borderRadius: 99,
    backgroundColor: '#A78BFA',
    borderWidth: 2,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  restoreBtn: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    width: 26,
    height: 26,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Empty */
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    boxShadow: '4px 4px 0px 0px #0F172A',
  },
  emptyText: { fontSize: 20, fontWeight: '900', color: '#0F172A' },
  emptySubText: { fontSize: 14, fontWeight: '600', color: '#065F46', marginTop: 6, textAlign: 'center' },

  /* Footer */
  footer: {
    paddingHorizontal: 18,
    paddingTop: 16,
    borderTopWidth: 3,
    borderTopColor: '#0F172A',
    backgroundColor: '#4ADE80',
  },
  deleteBtn: {
    flexDirection: 'row',
    backgroundColor: '#F87171',
    borderRadius: 99,
    borderWidth: 4,
    borderColor: '#0F172A',
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '6px 6px 0px 0px #0F172A',
  },
  deleteBtnText: { fontSize: 20, fontWeight: '800', color: '#0F172A', letterSpacing: 1 },
});
