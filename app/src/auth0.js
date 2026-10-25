// "Continue with Auth0" (react-native-auth0). It needs its native module, so only a development
// build made after it was added has it; in Expo Go, older APKs and the browser `auth0` is null and the
// button hides (importing the SDK there would crash the app).
import { Platform, TurboModuleRegistry } from 'react-native';

const DOMAIN = 'dev-igr7vxhgin21kqfz.us.auth0.com'; // also in app.json (the react-native-auth0 plugin)
const CLIENT_ID = 'FmXOoR0SNdpCU1ybGpfb8O3aOIxYLjPC'; // "ThuocTracker Mobile", a public native app: not a secret

const Auth0 = Platform.OS !== 'web' && TurboModuleRegistry.get('A0Auth0') ? require('react-native-auth0').default : null;
const client = Auth0 && new Auth0({ domain: DOMAIN, clientId: CLIENT_ID });

// Auth0's access token, or null if the person closed the login page.
// prompt=login: always show Auth0's form, so a shared phone can switch accounts without an Auth0 logout.
export async function auth0Token() {
  try {
    const c = await client.webAuth.authorize({ scope: 'openid profile email', additionalParameters: { prompt: 'login' } });
    return c.accessToken;
  } catch (e) {
    if (e.type === 'USER_CANCELLED') return null;
    throw e;
  }
}

export const hasAuth0 = !!client;
