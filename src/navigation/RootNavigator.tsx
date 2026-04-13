import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';

import HomeScreen from '../screens/HomeScreen';
import SwipeScreen from '../screens/SwipeScreen';
import TrashScreen from '../screens/TrashScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator 
      initialRouteName="Home"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0f172a' } }}
    >
      <Stack.Screen 
        name="Home" 
        component={HomeScreen} 
      />
      <Stack.Screen 
        name="Swipe" 
        component={SwipeScreen} 
        options={{ presentation: 'fullScreenModal' }} 
      />
      <Stack.Screen 
        name="Trash" 
        component={TrashScreen} 
        options={{ presentation: 'modal' }} 
      />
    </Stack.Navigator>
  );
}
