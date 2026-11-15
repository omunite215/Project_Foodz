import type { Preview } from '@storybook/nextjs-vite';
import '../app/globals.css';
import { fontVariables } from '../lib/fonts';

// Same as the root layout: the theme reads the font variables from <html>.
document.documentElement.classList.add(...fontVariables.split(' '));

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i } },
    // Accessibility problems show up as failures, not just hints.
    a11y: { test: 'error' },
  },
};

export default preview;
