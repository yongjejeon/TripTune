import icons from '@/constants/icons'; // Ensure this points to a valid icons file
import * as AuthSession from "expo-auth-session";
import { Tabs } from 'expo-router';
import React from 'react';
import { Image, Text, View } from 'react-native';

console.log(
  "Redirect URI:",
  AuthSession.makeRedirectUri({
    native: "your.app://redirect", // optional, for standalone builds
  })
);


const TabIcon = ({
  focused,
  icon,
  title,
}: {
  focused: boolean;
  icon: any;
  title: string;
}) => {
  return (
    <View className="flex-1 mt-3 flex flex-col items-center">
      <Image
        source={icon}
        className="w-6 h-6"
        resizeMode="contain"
        style={{ tintColor: focused ? '#0B2545' : '#666876' }}
      />
      <Text
        className={`text-[8px] text-center mt-1 ${
          focused ? 'text-primary-100 font-rubik-medium' : 'text-black-200 font-rubik'
        }`}
      >
        {title}
      </Text>
    </View>
  );
};

const TabsLayout = () => {
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: 'white',
          position: 'absolute',
          borderTopColor: '#0B2545',
          borderTopWidth: 1,
          minHeight: 70,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon icon={icons.home} focused={focused} title="Home" />
          ),
        }}
      />
      {/* Preference tab removed (route no longer exists) */}
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon icon={icons.search} focused={focused} title="Explore" />
          ),
        }}
      />
      <Tabs.Screen
        name="fatigue"
        options={{
          title: 'fatigue',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon icon={icons.home} focused={focused} title="fatigue" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon icon={icons.person} focused={focused} title="Profile" />
          ),
        }}
      />
    </Tabs>
    
  );
};

export default TabsLayout;
