import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';

import { RootStackParamList } from '../navigation/types';
import { useMediaStore } from '../store/useMediaStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Trash'>;

export default function TrashScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { pendingDeletion, confirmDeletion, incrementSpaceSaved, restoreItem } = useMediaStore();
  const [isDeleting, setIsDeleting] = useState(false);

  const calculateTotalSize = async (assetIds: string[]): Promise<number> => {
    let totalBytes = 0;
    try {
      for (const id of assetIds) {
        const info = await MediaLibrary.getAssetInfoAsync(id);
        // @ts-ignore: 'size' may not exist on type AssetInfo depending on expo version definitions
        if (info && info.size) { 
          // @ts-ignore
          totalBytes += info.size;
        } else {
          totalBytes += 2 * 1024 * 1024; // Fallback 2MB
        }
      }
    } catch(e) {
      console.warn("Failed to retrieve sizes", e);
    }
    return totalBytes > 0 ? totalBytes : assetIds.length * 2048 * 1024;
  };

  const handleConfirmDeletion = async () => {
    if (pendingDeletion.length === 0) return;

    Alert.alert(
      "Confirm Deletion",
      `Are you sure you want to permanently delete these ${pendingDeletion.length} items? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            const assetIds = pendingDeletion.map(a => a.id);
            
            try {
              // 1. Calculate space saved BEFORE deleting
              const bytesSaved = await calculateTotalSize(assetIds);

              // 2. Call Native Deletion Prompt
              const success = await MediaLibrary.deleteAssetsAsync(assetIds);
              
              if (success) {
                confirmDeletion(assetIds);
                incrementSpaceSaved(bytesSaved);
                Alert.alert("Success", `You have freed up ${(bytesSaved / (1024 * 1024)).toFixed(2)} MB!`);
                navigation.goBack();
              }
            } catch (err) {
              console.error("Deletion error:", err);
              Alert.alert("Error", "Could not delete assets. Please ensure you granted permission.");
            } finally {
              setIsDeleting(false);
            }
          }
        }
      ]
    );
  };

  const renderItem = ({ item }: { item: any }) => (
    <View style={styles.gridItem}>
      <Image
        source={item.uri}
        style={styles.thumbnail}
        contentFit="cover"
      />
      <TouchableOpacity 
        style={styles.restoreButton}
        onPress={() => restoreItem(item.id)}
      >
        <Ionicons name="refresh-outline" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#f8fafc" />
        </TouchableOpacity>
        <Text style={styles.title}>Pending Deletion</Text>
        <View style={{ width: 24 }} />
      </View>

      {pendingDeletion.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="layers-outline" size={64} color="#334155" />
          <Text style={styles.emptyText}>Nothing queued for deletion.</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={pendingDeletion}
            numColumns={3}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.grid}
          />
          <View style={styles.footer}>
            <TouchableOpacity 
              style={[styles.deleteButton, isDeleting && { opacity: 0.7 }]} 
              onPress={handleConfirmDeletion}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.deleteButtonText}>Delete {pendingDeletion.length} Items permanently</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ef4444',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#94a3b8',
    marginTop: 16,
    fontSize: 16,
  },
  grid: {
    padding: 2,
  },
  gridItem: {
    flex: 1/3,
    aspectRatio: 1,
    padding: 2,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  restoreButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  deleteButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 16,
    borderRadius: 99,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
