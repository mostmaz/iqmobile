// A single global navigation ref so non-screen components (like the
// app-wide NotificationBanner) can navigate without being inside a Navigator.
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export function go(name: string, params?: any) {
  if (navigationRef.isReady()) (navigationRef as any).navigate(name, params);
}

export function getCurrentRouteName(): string | undefined {
  if (!navigationRef.isReady()) return undefined;
  return navigationRef.getCurrentRoute()?.name;
}

export function getCurrentRouteParams(): any {
  if (!navigationRef.isReady()) return undefined;
  return navigationRef.getCurrentRoute()?.params;
}
