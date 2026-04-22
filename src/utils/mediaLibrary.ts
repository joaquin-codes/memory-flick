import * as MediaLibrary from 'expo-media-library';

export interface MonthGroup {
  key: string;       // "YYYY-MM"
  title: string;     // "October 2023"
  assets: MediaLibrary.Asset[];
}

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

  // Let's fetch up to a max to prevent extreme memory usage, or loop fully.
  // 10,000 items as a safe cap for this MVP
  try {
    while (hasNextPage && allAssets.length < 10000) {
      const response = await MediaLibrary.getAssetsAsync({
        first: 100,
        after: endCursor,
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      });

      if (response.assets.length === 0) {
        break; // Prevent infinite loop if API returns no items
      }

      allAssets = [...allAssets, ...response.assets];
      hasNextPage = response.hasNextPage;
      endCursor = response.endCursor;
      
      if (onProgress) {
        onProgress(allAssets, hasNextPage, response.totalCount);
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
