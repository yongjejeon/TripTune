// Custom Alert component with app-styled UI
import React from "react";
import {
  Modal,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Simple checkbox component
const Checkbox = ({ checked, onToggle }: { checked: boolean; onToggle: () => void }) => (
  <TouchableOpacity
    onPress={onToggle}
    className="flex-row items-center"
  >
    <View
      className={`w-5 h-5 border-2 rounded mr-2 items-center justify-center ${
        checked ? "bg-primary-100 border-primary-100" : "border-gray-400"
      }`}
    >
      {checked && (
        <Text className="text-white text-xs font-rubik-bold">✓</Text>
      )}
    </View>
  </TouchableOpacity>
);

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onDismiss?: () => void;
  showDoNotShowAgain?: boolean;
  onDoNotShowAgainChange?: (checked: boolean) => void;
  doNotShowAgainChecked?: boolean;
}

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: "OK" }],
  onDismiss,
  showDoNotShowAgain = false,
  onDoNotShowAgainChange,
  doNotShowAgainChecked = false,
}) => {
  React.useEffect(() => {
    if (visible) {
      console.log(`[CUSTOM ALERT] Alert shown: "${title}"`);
      console.log(`[CUSTOM ALERT] Buttons:`, buttons.map(b => ({ text: b.text, hasOnPress: !!b.onPress })));
    }
  }, [visible, title, buttons]);
  const handleButtonPress = async (button: AlertButton) => {
    console.log(`[CUSTOM ALERT] Button pressed: "${button.text}"`);
    if (button.onPress) {
      console.log(`[CUSTOM ALERT] Calling onPress for "${button.text}"`);
      try {
        const result = button.onPress();
        // If onPress returns a promise, wait for it
        if (result instanceof Promise) {
          console.log(`[CUSTOM ALERT] onPress is async, awaiting...`);
          await result;
          console.log(`[CUSTOM ALERT] Async onPress completed for "${button.text}"`);
        } else {
          console.log(`[CUSTOM ALERT] onPress completed synchronously for "${button.text}"`);
        }
      } catch (error) {
        console.error(`[CUSTOM ALERT] Error in onPress for "${button.text}":`, error);
      }
    } else {
      console.log(`[CUSTOM ALERT] No onPress handler for "${button.text}"`);
    }
    if (onDismiss) {
      console.log(`[CUSTOM ALERT] Calling onDismiss`);
      onDismiss();
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}
    >
      <View className="flex-1 justify-center items-center bg-black/50 px-6">
        <View className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
          {/* Title */}
          <Text className="text-xl font-rubik-bold text-black-300 mb-3 text-center">
            {title}
          </Text>

          {/* Message */}
          {message && (
            <Text className="text-sm font-rubik text-black-200 mb-6 text-center leading-5">
              {message}
            </Text>
          )}

          {/* Do Not Show Again Checkbox */}
          {showDoNotShowAgain && (
            <View className="mb-4 flex-row items-center justify-center">
              <Checkbox
                checked={doNotShowAgainChecked}
                onToggle={() => onDoNotShowAgainChange?.(!doNotShowAgainChecked)}
              />
              <Text className="text-sm font-rubik text-black-300">
                Do not show again for today
              </Text>
            </View>
          )}

          {/* Buttons */}
          <View>
            {buttons.map((button, index) => {
              const isCancel = button.style === "cancel";
              const isDestructive = button.style === "destructive";

              return (
                <TouchableOpacity
                  key={index}
                  onPress={() => handleButtonPress(button)}
                  className={`py-4 px-6 rounded-2xl ${index > 0 ? 'mt-2' : ''} ${
                    isDestructive
                      ? "bg-red-500"
                      : isCancel
                      ? "bg-general-100 border border-gray-300"
                      : "bg-primary-100"
                  }`}
                >
                  <Text
                    className={`text-center font-rubik-bold text-base ${
                      isCancel ? "text-black-300" : "text-white"
                    }`}
                  >
                    {button.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
};

// Hook to use custom alert
export const useCustomAlert = () => {
  const [alertConfig, setAlertConfig] = React.useState<{
    visible: boolean;
    title: string;
    message?: string;
    buttons?: AlertButton[];
    showDoNotShowAgain?: boolean;
    doNotShowAgainChecked?: boolean;
    onDoNotShowAgainChange?: (checked: boolean) => void;
  }>({
    visible: false,
    title: "",
    message: "",
    buttons: [],
    showDoNotShowAgain: false,
    doNotShowAgainChecked: false,
  });

  const showAlert = React.useCallback(
    (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: {
        showDoNotShowAgain?: boolean;
        onDoNotShowAgainChange?: (checked: boolean) => void;
      }
    ) => {
      setAlertConfig({
        visible: true,
        title,
        message,
        buttons: buttons || [{ text: "OK" }],
        showDoNotShowAgain: options?.showDoNotShowAgain || false,
        doNotShowAgainChecked: false,
        onDoNotShowAgainChange: options?.onDoNotShowAgainChange,
      });
    },
    []
  );

  const hideAlert = React.useCallback(() => {
    setAlertConfig((prev) => ({ ...prev, visible: false, doNotShowAgainChecked: false }));
  }, []);

  const AlertComponent = React.useCallback(
    () => (
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title || ""}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={hideAlert}
        showDoNotShowAgain={alertConfig.showDoNotShowAgain}
        doNotShowAgainChecked={alertConfig.doNotShowAgainChecked}
        onDoNotShowAgainChange={(checked) => {
          setAlertConfig((prev) => ({ ...prev, doNotShowAgainChecked: checked }));
          alertConfig.onDoNotShowAgainChange?.(checked);
        }}
      />
    ),
    [alertConfig, hideAlert]
  );

  return { showAlert, AlertComponent, hideAlert };
};

