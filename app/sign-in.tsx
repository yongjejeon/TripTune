import { useGlobalContext } from "@/lib/global-provider";
import { useRouter } from "expo-router";
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const SignIn = () => {
    const {refetch, loading, isLoggedIn, setIsLoggedIn} = useGlobalContext();
    const router = useRouter();

    // if (!loading && isLoggedIn) {
    //     return <Redirect href="/" />;
    // }
    const handleLogin = () => {
        // After sign-in, go to Health Connect setup
        router.replace("/(root)/health-setup");
      };
  
    // const handleLogin = async () => {
    //     const result = await login();

    //     if(result){
    //         console.log('Login Success');
    //         refetch();
    //     } else{
    //         Alert.alert('Error', 'Failed to login');
    //     }
    // };
    return (
        <SafeAreaView className="bg-white h-full">
            <View className="flex-1 px-10">
                <View className="flex-1 justify-center items-center">
                    {/* Logo */}
                    <Image 
                        source={require('../logo without text.png')}
                        className="w-32 h-32 mb-8"
                        resizeMode="contain"
                    />
                    
                    {/* Title */}
                    <Text className="text-3xl text-center uppercase font-rubik-bold text-primary-100">
                        TRIPTUNE
                    </Text>
                    
                    {/* Subtitle */}
                    <Text className="text-base text-center uppercase font-rubik text-black-200 mt-10">
                        YOUR TRIP TUNED TO YOUR ENERGY
                    </Text>
                </View>

                {/* Button at bottom */}
                <View className="pb-8">
                    <TouchableOpacity onPress={handleLogin} className="bg-primary-100 shadow-md shadow-zinc-300 rounded-full w-full py-4">
                        <View className="flex flex-row items-center justify-center">
                            <Text className="text-lg font-rubik-bold text-white">
                                Let's Start
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    )
}

export default SignIn