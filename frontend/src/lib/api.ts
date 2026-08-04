const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1';

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];
let memoryAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  memoryAccessToken = token;
}

export function getAccessToken() {
  return memoryAccessToken;
}

function onRefreshed(token: string) {
  refreshSubscribers.map((cb) => cb(token));
  refreshSubscribers = [];
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
  let token = memoryAccessToken;
  
  if (!token && typeof window !== 'undefined') {
    token = localStorage.getItem('access_token');
    if (token === 'undefined' || token === 'null') {
      token = null;
    }
  }

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Ensure cookies (refresh_token) are sent with every request
  options.credentials = 'include';

  let response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized (Token Expired)
  if (response.status === 401 && endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // vital for sending the refresh_token cookie
        });

        if (!refreshRes.ok) {
          throw new Error('Session expired');
        }

        const resJson = await refreshRes.json();
        const refreshData = resJson.data || resJson;
        setAccessToken(refreshData.accessToken);
        token = refreshData.accessToken;
        onRefreshed(token as string);
      } catch (error) {
        setAccessToken(null);
        onRefreshed('');
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        throw new Error('Session expired. Please log in again.');
      } finally {
        isRefreshing = false;
      }
    } else {
      // Wait for the ongoing refresh to complete
      token = await new Promise((resolve) => {
        refreshSubscribers.push((newToken: string) => {
          resolve(newToken);
        });
      });
      if (!token) {
        throw new Error('Session expired. Please log in again.');
      }
    }

    // Retry the original request with the new token
    headers.set('Authorization', `Bearer ${token}`);
    response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.message || `API request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}
