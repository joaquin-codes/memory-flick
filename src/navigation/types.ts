export type RootStackParamList = {
  Home: undefined;
  Swipe: { monthKey: string; filter: 'all' | 'images' | 'videos' }; // monthKey: 'YYYY-MM'
  Trash: { monthKey?: string };
};
