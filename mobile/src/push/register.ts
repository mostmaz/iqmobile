import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { Auth } from '../api/endpoints';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken() {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync();
    if (tokenResp?.data) {
      await Auth.pushToken(tokenResp.data);
    }
  } catch (e) {
    console.warn('push register failed', e);
  }
}
