// Three layers of notifications, best available wins:
// 1. Real push (Expo push service): needs an Expo projectId (`npx eas init`) and, on Android,
//    a development build. When it works, the backend pushes alerts/messages to this phone.
// 2. Local phone notifications: while the app runs, polling spots new alerts/messages.
// 3. In-app banner: Expo Go on Android ships without the notification native modules, and
//    importing expo-notifications there crashes the app, so we only show a banner inside the app.
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

const NATIVE_MODULES = [
  'NotificationsServerRegistrationModule', 'ExpoTopicSubscriptionModule', 'ExpoPushTokenManager',
  'ExpoNotificationsHandlerModule', 'ExpoNotificationsEmitter', 'ExpoNotificationScheduler',
  'ExpoNotificationPresenter', 'ExpoNotificationPermissionsModule', 'ExpoNotificationChannelManager',
  'ExpoNotificationChannelGroupManager', 'ExpoNotificationCategoriesModule', 'ExpoBadgeModule',
  'ExpoBackgroundNotificationTasksModule',
];
const Notifications = NATIVE_MODULES.every((m) => requireOptionalNativeModule(m))
  ? require('expo-notifications')
  : null;

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let pushWorks = false;
export const hasRealPush = () => pushWorks;

let bannerListener = null;
export const onBanner = (fn) => { bannerListener = fn; };

export async function setupNotifications(role, userId) {
  if (!Notifications) return;
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
    if (!projectId) return; // no Expo project yet: local notifications only
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPush(role, userId, token);
    pushWorks = true;
  } catch (e) {
    console.log('[push] not available, using local notifications:', e.message);
  }
}

export function localNotify(title, body) {
  if (pushWorks) return; // the backend already pushed it
  if (Notifications) {
    Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null }).catch(() => {});
  } else {
    bannerListener?.({ title, body });
  }
}
