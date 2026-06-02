import { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';

export interface PermissionsState {
  camera: boolean;
  location: boolean;
  loading: boolean;
}

export const useCameraPermissions = () => {
  const [permissions, setPermissions] = useState<PermissionsState>({
    camera: false,
    location: false,
    loading: true,
  });

  const requestPermissions = async () => {
    try {
      setPermissions(prev => ({ ...prev, loading: true }));

      let hasCamera = false;
      let hasLocation = false;

      if (Platform.OS === 'android') {
        // Request Android permissions
        const cameraStatus = await Camera.requestCameraPermission();
        hasCamera = cameraStatus === 'granted';

        const locationGranted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);

        hasLocation =
          locationGranted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;
      } else {
        // Request iOS permissions
        const cameraStatus = await Camera.requestCameraPermission();
        hasCamera = cameraStatus === 'granted';
        hasLocation = true; // Simulated iOS core location permission
      }

      setPermissions({
        camera: hasCamera,
        location: hasLocation,
        loading: false,
      });

      return { camera: hasCamera, location: hasLocation };
    } catch (e) {
      console.error('[useCameraPermissions] Error requesting permissions:', e);
      setPermissions(prev => ({ ...prev, loading: false }));
      return { camera: false, location: false };
    }
  };

  useEffect(() => {
    // Check initial permissions status
    const checkInitialStatus = async () => {
      try {
        const cameraPermission = await Camera.getCameraPermissionStatus();
        let hasLocation = false;

        if (Platform.OS === 'android') {
          hasLocation = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );
        } else {
          hasLocation = true;
        }

        setPermissions({
          camera: cameraPermission === 'granted',
          location: hasLocation,
          loading: false,
        });
      } catch (err) {
        console.error('[useCameraPermissions] Error checking permissions:', err);
        setPermissions(prev => ({ ...prev, loading: false }));
      }
    };

    checkInitialStatus();
  }, []);

  return {
    ...permissions,
    requestPermissions,
  };
};
