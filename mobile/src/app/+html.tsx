import { ScrollViewStyleReset } from 'expo-router/html';
import { getWebContentSecurityPolicy } from '../utils/web-security-policy';
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta httpEquiv="Content-Security-Policy" content={getWebContentSecurityPolicy(__DEV__)} />
    <meta name="referrer" content="no-referrer" />
    <ScrollViewStyleReset />
  </head><body>{children}</body></html>;
}
