import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder, Dimensions, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { RootStackParamList } from '../navigation/types';
import { fetchAllMedia, groupAssetsByMonth } from '../utils/mediaLibrary';
import { useMediaStore, PendingAsset } from '../store/useMediaStore';
import * as MediaLibrary from 'expo-media-library';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = 120;

type Props = NativeStackScreenProps<RootStackParamList, 'Swipe'>;

const VideoCard = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, player => {
    player.loop = true;
    player.play();
  });
  return (
    <VideoView player={player} style={styles.cardImage} contentFit="cover" />
  );
};

export default function SwipeScreen({ route, navigation }: Props) {
  const { monthKey, filter } = route.params;
  const insets = useSafeAreaInsets();
  
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sortBySize, setSortBySize] = useState(false);

  const { keptItems, pendingDeletion, keepItem, markForDeletion, undoLastAction } = useMediaStore();

  useEffect(() => {
    const load = async () => {
      const allAssets = await fetchAllMedia();
      const groups = groupAssetsByMonth(allAssets);
      let targetGroup = groups.find(g => g.key === monthKey)?.assets || [];
      
      if (filter === 'images') {
        targetGroup = targetGroup.filter(a => a.mediaType === MediaLibrary.MediaType.photo);
      } else if (filter === 'videos') {
        targetGroup = targetGroup.filter(a => a.mediaType === MediaLibrary.MediaType.video);
      }

      // Instead of filtering out processed items, we keep them to show in the carousel
      if (sortBySize) {
        // Mock data width/height used as rough proxy for size, or duration if video
        targetGroup.sort((a, b) => (b.width * b.height) - (a.width * a.height));
      }

      setAssets(targetGroup);
      setLoading(false);
    };
    load();
  }, [monthKey, filter, sortBySize]);

  const currentAssetRef = useRef<number>(0);
  useEffect(() => {
    currentAssetRef.current = currentIndex;
  }, [currentIndex]);

  // Use Ref to always have the latest assets array in panResponder handlers
  const assetsRef = useRef(assets);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const position = useRef(new Animated.ValueXY()).current;
  const [isSwiping, setIsSwiping] = useState(false);

  // Automatically redirect when done
  useEffect(() => {
    if (!loading && assets.length > 0 && currentIndex >= assets.length) {
      if (pendingDeletion.length > 0) {
        navigation.replace('Trash');
      } else {
        navigation.goBack();
      }
    }
  }, [loading, assets.length, currentIndex, pendingDeletion.length, navigation]);

  // We should recreate panResponder only once, reading from refs
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (event, gesture) => {
        setIsSwiping(true);
        position.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (event, gesture) => {
        setIsSwiping(false);
        if (gesture.dx > SWIPE_THRESHOLD) {
          forceSwipe('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          forceSwipe('left');
        } else {
          resetPosition();
        }
      }
    })
  ).current;

  const forceSwipe = (direction: 'right' | 'left') => {
    const x = direction === 'right' ? SCREEN_WIDTH + 100 : -SCREEN_WIDTH - 100;
    Animated.timing(position, {
      toValue: { x, y: 0 },
      duration: 250,
      useNativeDriver: false
    }).start(() => onSwipeComplete(direction));
  };

  const resetPosition = () => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 5,
      useNativeDriver: false
    }).start();
  };

  const onSwipeComplete = (direction: 'right' | 'left') => {
    const latestAssets = assetsRef.current;
    if (latestAssets.length === 0 || currentAssetRef.current >= latestAssets.length) return;
    
    const item = latestAssets[currentAssetRef.current]; 
    if (!item) return;

    const pendingAsset: PendingAsset = {
      id: item.id,
      uri: item.uri,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
      duration: item.duration
    };

    if (direction === 'right') {
      keepItem(pendingAsset);
    } else {
      markForDeletion(pendingAsset);
    }
    
    position.setValue({ x: 0, y: 0 });
    setCurrentIndex(prev => prev + 1);
  };

  const getCardStyle = () => {
    const rotate = position.x.interpolate({
      inputRange: [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
      outputRange: ['-15deg', '0deg', '15deg'],
      extrapolate: 'clamp'
    });

    return {
      transform: [
        { translateX: position.x },
        { translateY: position.y },
        { rotate }
      ]
    };
  };

  const renderTopTags = () => {
    const likeOpacity = position.x.interpolate({ inputRange: [0, 50], outputRange: [0, 1], extrapolate: 'clamp' });
    const deleteOpacity = position.x.interpolate({ inputRange: [-50, 0], outputRange: [1, 0], extrapolate: 'clamp' });

    return (
      <View style={styles.tagWrapper}>
        <Animated.View style={[styles.likeTag, { opacity: likeOpacity, alignSelf: 'flex-start', transform: [{rotate: '-15deg'}] }]}>
          <Text style={styles.likeText}>KEEP</Text>
        </Animated.View>
        <Animated.View style={[styles.deleteTag, { opacity: deleteOpacity, alignSelf: 'flex-end', transform: [{rotate: '15deg'}] }]}>
          <Text style={styles.deleteText}>TRASH</Text>
        </Animated.View>
      </View>
    );
  };

  const renderMedia = (asset: MediaLibrary.Asset, isActive: boolean) => {
    if (asset.mediaType === MediaLibrary.MediaType.video) {
      if (!isActive) {
        return (
          <View style={styles.cardEmpty}>
              <Ionicons name="videocam-outline" size={64} color="#94a3b8" />
              <Text style={{color: '#94a3b8', marginTop: 10}}>Video Ready</Text>
          </View>
        );
      }
      return <VideoCard uri={asset.uri} />;
    }
    
    return (
      <Image
        source={asset.uri}
        style={styles.cardImage}
        contentFit="cover"
        transition={200}
      />
    );
  };



  if (loading || (assets.length === 0 && !loading)) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={28} color="#f8fafc" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.iconButton} onPress={() => setSortBySize(!sortBySize)}>
          <Ionicons name={sortBySize ? "funnel" : "funnel-outline"} size={20} color={sortBySize ? "#a855f7" : "#f8fafc"} />
          <Text style={{color: sortBySize ? "#a855f7" : "#f8fafc", fontSize: 10, marginTop: 2}}>Size</Text>
        </TouchableOpacity>

        <View style={{alignItems: 'center'}}>
          <Text style={styles.headerTitle}>{monthKey}</Text>
          {sortBySize && <Text style={{color: '#a855f7', fontSize: 11, fontWeight: 'bold'}}>Largest First</Text>}
        </View>

        <TouchableOpacity style={styles.iconButton} onPress={() => undoLastAction()}>
          <Ionicons name="arrow-undo-outline" size={24} color="#f8fafc" />
        </TouchableOpacity>
      </View>

      {/* Up Next Carousel */}
      <View style={styles.carouselContainer}>
        <Animated.ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 20}}>
          {assets.map((asset, i) => {
            const isCurrent = i === currentIndex;
            const isKept = !!keptItems[asset.id];
            const isTrashed = pendingDeletion.some(p => p.id === asset.id);

            return (
              <TouchableOpacity key={asset.id} onPress={() => setCurrentIndex(i)} style={{alignItems: 'center'}}>
                <View>
                  <Image 
                    source={asset.uri} 
                    style={[
                      styles.carouselImage, 
                      isCurrent && styles.carouselImageActive,
                      isKept && {borderColor: '#4ade80'},
                      isTrashed && {borderColor: '#ef4444'}
                    ]} 
                    contentFit="cover" 
                  />
                  {isKept && <Ionicons name="heart" size={16} color="#4ade80" style={{position: 'absolute', bottom: -5, right: -5}} />}
                  {isTrashed && <Ionicons name="close-circle" size={16} color="#ef4444" style={{position: 'absolute', bottom: -5, right: -5}} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.ScrollView>
      </View>

      <View style={styles.cardContainer}>
        {assets.map((asset, index) => {
          if (index < currentIndex || index > currentIndex + 1) return null;

          if (index === currentIndex) {
            return (
              <Animated.View
                key={asset.id}
                style={[styles.card, getCardStyle()]}
                {...panResponder.panHandlers}
              >
                {renderMedia(asset, true)}
                {renderTopTags()}
              </Animated.View>
            );
          }

          // Next Card (Underneath)
          return (
            <Animated.View key={asset.id} style={[styles.card, { transform: [{ scale: 0.95 }], top: 10, zIndex: -1 }]}>
               {renderMedia(asset, false)}
            </Animated.View>
          );
        }).reverse()}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: '#ef4444' }]} onPress={() => forceSwipe('left')}>
          <Ionicons name="close" size={32} color="#ef4444" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: '#4ade80' }]} onPress={() => forceSwipe('right')}>
          <Ionicons name="heart" size={32} color="#4ade80" />
        </TouchableOpacity>
      </View>
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
  },
  iconButton: {
    padding: 8,
    backgroundColor: '#1e293b',
    borderRadius: 20,
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
  },
  carouselContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginVertical: 10,
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carouselImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  carouselImageActive: {
    width: 56,
    height: 56,
    borderWidth: 3,
    borderColor: '#a855f7',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.85,
    height: '90%',
    backgroundColor: '#1e293b',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b'
  },
  tagWrapper: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  likeTag: {
    borderWidth: 4,
    borderColor: '#4ade80',
    borderRadius: 8,
    padding: 8,
    backgroundColor: 'rgba(74, 222, 128, 0.2)',
  },
  likeText: {
    color: '#4ade80',
    fontSize: 32,
    fontWeight: '900',
  },
  deleteTag: {
    borderWidth: 4,
    borderColor: '#ef4444',
    borderRadius: 8,
    padding: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  deleteText: {
    color: '#ef4444',
    fontSize: 32,
    fontWeight: '900',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingBottom: 40,
    paddingTop: 20,
  },
  actionBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
  },
  doneText: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 32,
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#334155',
    borderRadius: 99,
  },
  backButtonText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
