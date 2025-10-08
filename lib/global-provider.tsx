import { useAppwrite } from "@/lib/useAppwrite";
import React, { createContext, ReactNode, useContext, } from "react";
import { getCurrentUser } from "./appwrite";

interface User {
  $id: string;
  name: string;
  email: string;
  avatar: string;
}

interface GlobalContextType {
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void; 
  user: User | null;
  loading: boolean;
  refetch: (newParams?: Record<string, string | number>) => Promise<void>;
}

// Create context
const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

// Create provider
export const GlobalProvider = ({ children }: { children: ReactNode }) => {
  const {
    data: user,
    loading,
    refetch
  } = useAppwrite({ fn: getCurrentUser }); // ✅ Corrected hook usage

  const isLoggedIn = !!user;

  //console.log(JSON.stringify(user, null, 2))

  return (
    <GlobalContext.Provider value={{ isLoggedIn, user, loading, refetch }}>
      {children}
    </GlobalContext.Provider>
  );
};
export const useGlobalContext = (): GlobalContextType => {
    const context = useContext(GlobalContext);

    if(!context) {
        throw new Error('useGlobalContext mustr be used within a Global Provider');
    }
    return context;
}
export default GlobalProvider;
