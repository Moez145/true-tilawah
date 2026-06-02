import { registerRootComponent } from 'expo';
import App from './App';

// Registers the root component as "main" so the dev client / native runtime
// can find it. Required for Expo SDK 54+ with expo-dev-client.
registerRootComponent(App);
