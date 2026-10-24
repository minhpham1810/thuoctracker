// Two layers of notifications:
// 1. Real push (Expo push service): needs an Expo projectId (`npx eas init`) and, on Android,
//    a development build. When it works, the backend pushes alerts/messages to this phone.
// 2. Local fallback: while the app runs, polling spots new alerts/messages and shows a
//    notification itself. Works in Expo Go on both platforms.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let pushWorks = false;
export const hasRealPush = () => pushWorks;

export async function setupNotifications(role, userId) {
  try {
    if (Platform.OS === 'android') {
      // Android 13 won't show the permission prompt until a channel exists
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted' || !Device.isDevice) return;

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return; // no Expo project yet: local fallback only
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPush(role, userId, token);
    pushWorks = true;
  } catch (e) {
    console.log('[push] not available, using local notifications:', e.message);
  }
}

export function localNotify(title, body) {
  if (pushWorks) return; // the backend already pushed it
  Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {});
}
