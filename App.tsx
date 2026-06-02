/**
 * NHAI Offline Face Recognition & Liveness System
 * Hackathon 7.0 Main Application Entrance
 */

import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraScanner } from './src/components/CameraScanner';

function App() {
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
