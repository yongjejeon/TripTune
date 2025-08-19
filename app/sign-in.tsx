import { login } from "@/lib/appwrite";
import { useGlobalContext } from "@/lib/global-provider";
import { Redirect } from "expo-router";
import React from 'react';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GoogleIcon from '../assets/icons/google.png';

const SignIn = () => {
    const {refetch, loading, isLoggedIn} = useGlobalContext();

    if (!loading && isLoggedIn) {
        return <Redirect href="/" />;
    }
    const handleLogin = async () => {
        const result = await login();

        if(result){
            console.log('Login Success');
            refetch();
        } else{
            Alert.alert('Error', 'Failed to login');
        }
    };
    return (
        <SafeAreaView className= "bg-white h-full">
            <ScrollView contentContainerClassName="h-full">
                <View className = "px-10">
                    <Text className = "text-3xl text-center uppercase font-rubik-bold text-primary-100 mt-60">
                        TRIPTUNE
                    </Text>
                    <Text className = "text-base text-center uppercase font-rubik text-black-200 mt-10">
                        YOUR TRIP TUNED TO YOUR ENERGY
                    </Text>

                    <Text className = "text-lg text-center font-rubik text-black-200 mt-20">
                        Login to TripTune with Google
                    </Text>

                    <TouchableOpacity onPress={handleLogin} className = "bg-white shadow-md shadow-zinc-300 rounded-full w-full py-4 mt-5">
                        <View className="flex flex-row items-center justify-center">
                            <Image
                                source={GoogleIcon}
                                className="w-5 h-5"
                                resizeMode="contain"
                            />
                            <Text className = "text-lg font-rubik-medium text-black-300 ml-2">
                                Continue with Google
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </SafeAreaView>
    )
}

export default SignIn