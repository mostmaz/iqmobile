// Expo SDK 54+ entry point. The old `node_modules/expo/AppEntry.js` is no
// longer honored — Metro looks for `./index` at the project root, which
// must call registerRootComponent. This is the official replacement.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
