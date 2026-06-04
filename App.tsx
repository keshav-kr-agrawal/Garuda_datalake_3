/**
 * NHAI Offline Face Recognition & Liveness Detection System
 * Hackathon 7.0 — Offline module for NHAI Datalake 3.0
 *
 * Integration context:
 * This module is designed to plug into the existing Datalake 3.0 app
 * (com.digitalindiacorporation.datalake) by Digital India Corporation.
 * The existing app uses a .NET backend on NIC servers. Our module adds
 * fully offline facial recognition + liveness so field officers can mark
 * attendance in zero-network zones. Records are synced to NIC on reconnect.
 */

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraScanner } from './src/components/CameraScanner';
import { DatalakeApiService } from './src/services/datalakeApiService';
import { LocalDatabaseService } from './src/services/databaseSchema';

function App() {
  useEffect(() => {
    const bootServices = async () => {
      try {
        // 1. Initialize NIC Datalake 3.0 API bridge
        //    - Restores cached login session for offline use
        //    - Loads offline attendance queue from AsyncStorage
        //    - Sets up network listener for auto-sync on reconnect
        await DatalakeApiService.getInstance().initialize();
        console.log('[App] DatalakeApiService initialized (NIC backend bridge ready).');

        // 2. Seed local face DB if empty (for hackathon demo)
        //    In production: roster is downloaded from NIC /roster/download on login
        await LocalDatabaseService.getInstance().seedDatabaseIfEmpty();
        console.log('[App] Local face database ready.');
      } catch (err) {
        console.error('[App] Boot error:', err);
      }
    };

    bootServices();

    // Cleanup: remove network listeners on app unmount
    return () => {
      DatalakeApiService.getInstance().destroy();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0a0f1d" />
      <View style={styles.container}>
        <CameraScanner />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0f1d',
  },
});

export default App;
