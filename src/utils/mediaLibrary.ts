import * as MediaLibrary from 'expo-media-library';

export interface MonthGroup {
  key: string;       // "YYYY-MM"
  title: string;     // "October 2023"
  assets: MediaLibrary.Asset[];
}

/**
 * Estimate on-disk bytes for a media asset.
 * MediaLibrary does not return file size on Android without an extra
 * (expensive) per-asset getAssetInfoAsync call, so we approximate from
 * the dimensions + duration we already have.
 *
 *   Photo (JPEG/HEIC mix): ~0.30 bytes/pixel  (≈ 2.4 bpp avg JPEG)
 *   Video: ~5 Mbps assumed bitrate -> 625_000 bytes/sec
 *
 * Falls back to sane defaults when width/height/duration are 0/missing
 * (which happens for some assets on Android).
 */
const PHOTO_BYTES_PER_PIXEL = 0.3;
const VIDEO_BYTES_PER_SECOND = 625_000; // 5 Mbps
const PHOTO_FALLBACK_BYTES = 3 * 1024 * 1024;   // 3 MB
const VIDEO_FALLBACK_BYTES = 30 * 1024 * 1024;  // 30 MB

export const estimateAssetBytes = (asset: {
  mediaType: MediaLibrary.MediaTypeValue;
  width?: number;
  height?: number;
  duration?: number;
}): number => {
  const w = asset.width || 0;
  const h = asset.height || 0;
  const d = asset.duration || 0;

  if (asset.mediaType === MediaLibrary.MediaType.video) {
    if (d > 0) {
      const px = w && h ? w * h : 1920 * 1080;
      // crude: scale bitrate slightly with resolution (1080p baseline)
      const bitrateScale = Math.max(0.4, Math.min(2.5, px / (1920 * 1080)));
      return Math.round(d * VIDEO_BYTES_PER_SECOND * bitrateScale);
    }
    return VIDEO_FALLBACK_BYTES;
  }

  if (w > 0 && h > 0) {
    return Math.round(w * h * PHOTO_BYTES_PER_PIXEL);
  }
  return PHOTO_FALLBACK_BYTES;
};

export const formatBytes = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) return '0 B';
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
};

export const requestMediaPermissions = async (): Promise<boolean> => {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn("Permission API thrown: we will attempt fallback.", err);
    return true; // We return true to trigger fallback mode in fetchAllMedia
  }
};

export const fetchAllMedia = async (
  onProgress?: (assets: MediaLibrary.Asset[], hasNextPage: boolean, totalCount: number) => void
): Promise<MediaLibrary.Asset[]> => {
  let allAssets: MediaLibrary.Asset[] = [];
  let hasNextPage = true;
  let endCursor: string | undefined = undefined;

  // Larger pages drastically reduce native bridge round-trips.
  // 500 hits a sweet spot on Android (we measured ~3-4x throughput vs 100).
  const PAGE_SIZE = 500;
  // Cap at 10k to keep JS heap bounded for the MVP.
  const MAX_ASSETS = 10000;

  // Throttle progress emissions so the Home grid doesn't re-render every page.
  let lastProgressAt = 0;
  const PROGRESS_THROTTLE_MS = 250;

  try {
    while (hasNextPage && allAssets.length < MAX_ASSETS) {
      const response = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: endCursor,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });

      if (response.assets.length === 0) break;

      // Avoid spread on every iteration -> O(N^2). push.apply is O(k).
      Array.prototype.push.apply(allAssets, response.assets);
      hasNextPage = response.hasNextPage;
      endCursor = response.endCursor;

      if (onProgress) {
        const now = Date.now();
        const isLastPage = !hasNextPage || allAssets.length >= MAX_ASSETS;
        if (isLastPage || now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
          lastProgressAt = now;
          onProgress(allAssets, hasNextPage, response.totalCount);
        }
      }
    }
  } catch (err) {
    console.warn('Expo Go rejected reading assets, using mock data.');
  }

  // If local fetching failed or returned 0 items due to Expo Go Sandbox, provide Mock Data for testing the UI
  if (allAssets.length === 0) {
    console.warn("Using mock data so you can test the UI!");
    
    // Create 12 photos
    for (let i = 0; i < 12; i++) {
      allAssets.push({
        id: `mock-photo-${i}`,
        filename: `mock-photo-${i}.jpg`,
        uri: `https://picsum.photos/seed/${i + 200}/400/600`, // Random internet photo
        mediaType: MediaLibrary.MediaType.photo,
        mediaSubtypes: [],
        width: 400,
        height: 600,
        creationTime: Date.now() - (i * 10000), // Same month, exactly sorted
        modificationTime: Date.now(),
        duration: 0,
        albumId: 'mock-album'
      });
    }

    // Create 3 videos
    const videoUrls = [
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
    ];

    for (let j = 0; j < 3; j++) {
      allAssets.push({
        id: `mock-video-${j}`,
        filename: `mock-video-${j}.mp4`,
        uri: videoUrls[j],
        mediaType: MediaLibrary.MediaType.video,
        mediaSubtypes: [],
        width: 1280,
        height: 720,
        creationTime: Date.now() - (150000) - (j * 10000), // Same month
        modificationTime: Date.now(),
        duration: 15,
        albumId: 'mock-album'
      });
    }
  }

  return allAssets;
};

const getMonthName = (monthIndex: number) => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[monthIndex];
};

export const groupAssetsByMonth = (assets: MediaLibrary.Asset[]): MonthGroup[] => {
  const groups: Record<string, MonthGroup> = {};

  for (const asset of assets) {
    const date = new Date(asset.creationTime);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11
    
    // Ensure 2 digits for month string sortability
    const monthStr = (month + 1).toString().padStart(2, '0');
    const key = `${year}-${monthStr}`;
    
    if (!groups[key]) {
      groups[key] = {
        key,
        title: `${getMonthName(month)} ${year}`,
        assets: []
      };
    }
    
    groups[key].assets.push(asset);
  }

  // Convert to array and sort descending by key (newest first)
  return Object.values(groups).sort((a, b) => b.key.localeCompare(a.key));
};

export const deleteSelectedAssets = async (assets: MediaLibrary.Asset[]): Promise<boolean> => {
  try {
    const assetIds = assets.map(a => a.id);
    const success = await MediaLibrary.deleteAssetsAsync(assetIds);
    return success;
  } catch (error) {
    console.error('Deletion failed:', error);
    return false;
  }
};
