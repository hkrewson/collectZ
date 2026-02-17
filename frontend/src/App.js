import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const TOKEN_KEY = 'mediavault_token';
const USER_KEY = 'mediavault_user';

const DEFAULT_MEDIA_FORM = {
  title: '',
  original_title: '',
  release_date: '',
  year: '',
  format: 'Blu-ray',
  genre: '',
  director: '',
  rating: '',
  user_rating: 0,
  runtime: '',
  upc: '',
  location: '',
  notes: '',
  overview: '',
  tmdb_id: '',
  poster_path: '',
  backdrop_path: ''
};

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const USER_ROLES = ['admin', 'user', 'viewer'];
const BARCODE_PRESETS = {
  upcitemdb: {
    barcodePreset: 'upcitemdb',
    barcodeProvider: 'upcitemdb',
    barcodeApiUrl: 'https://api.upcitemdb.com/prod/trial/lookup',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc'
  },
  barcodelookup: {
    barcodePreset: 'barcodelookup',
    barcodeProvider: 'barcodelookup',
    barcodeApiUrl: 'https://api.barcodelookup.com/v3/products',
    barcodeApiKeyHeader: 'Authorization',
    barcodeQueryParam: 'barcode'
  },
  custom: {
    barcodePreset: 'custom',
    barcodeProvider: 'custom',
    barcodeApiUrl: '',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc'
  }
};
const VISION_PRESETS = {
  ocrspace: {
    visionPreset: 'ocrspace',
    visionProvider: 'ocrspace',
    visionApiUrl: 'https://api.ocr.space/parse/image',
    visionApiKeyHeader: 'apikey'
  },
  custom: {
    visionPreset: 'custom',
    visionProvider: 'custom',
    visionApiUrl: '',
    visionApiKeyHeader: 'x-api-key'
  }
};
const TMDB_PRESETS = {
  tmdb: {
    tmdbPreset: 'tmdb',
    tmdbProvider: 'tmdb',
    tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKeyHeader: '',
    tmdbApiKeyQueryParam: 'api_key'
  },
  custom: {
    tmdbPreset: 'custom',
    tmdbProvider: 'custom',
    tmdbApiUrl: '',
    tmdbApiKeyHeader: '',
    tmdbApiKeyQueryParam: 'api_key'
  }
};
const TMDB_GENRE_MAP = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

function routeFromPath(pathname) {
  if (pathname === '/register') return 'register';
  if (pathname === '/dashboard') return 'dashboard';
  return 'login';
}

function readStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function posterUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/uploads/')) return path;
  if (path.startsWith('/')) return `https://image.tmdb.org/t/p/w500${path}`;
  return path;
}

function StarRating({ value = 0, onChange, readOnly = false }) {
  const safeValue = Number(value) || 0;
  const stars = [1, 2, 3, 4, 5];

  const selectFromClick = (star, event) => {
    if (readOnly || !onChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const isHalf = event.clientX - rect.left < rect.width / 2;
    onChange(isHalf ? star - 0.5 : star);
  };

  return (
    <div className={`star-rating ${readOnly ? 'readonly' : ''}`}>
      {stars.map((star) => {
        const fill = safeValue >= star ? 1 : safeValue >= star - 0.5 ? 0.5 : 0;
        return (
          <button
            key={star}
            type="button"
            className="star-button"
            onClick={(event) => selectFromClick(star, event)}
            disabled={readOnly}
            aria-label={`${star} star`}
          >
            <span className="star-base">★</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>★</span>
          </button>
        );
      })}
      <span className="star-value">{safeValue ? safeValue.toFixed(1) : '0.0'}</span>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(routeFromPath(window.location.pathname));
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(readStoredUser());
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');

  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authInviteToken, setAuthInviteToken] = useState('');

  const [activeTab, setActiveTab] = useState('library');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 900);
  const [isMobileNav, setIsMobileNav] = useState(window.innerWidth <= 900);
  const [adminMenuOpen, setAdminMenuOpen] = useState(true);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFormat, setLibraryFormat] = useState('all');
  const [libraryViewMode, setLibraryViewMode] = useState('cards');
  const [detailMediaId, setDetailMediaId] = useState(null);
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');

  const [mediaForm, setMediaForm] = useState(DEFAULT_MEDIA_FORM);
  const [addMode, setAddMode] = useState('title');
  const [mediaSubmitting, setMediaSubmitting] = useState(false);
  const [mediaSubmitMessage, setMediaSubmitMessage] = useState('');
  const [tmdbResults, setTmdbResults] = useState([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [coverUploadMessage, setCoverUploadMessage] = useState('');
  const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
  const [barcodeLookupMessage, setBarcodeLookupMessage] = useState('');
  const [barcodeLookupResults, setBarcodeLookupResults] = useState([]);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionMessage, setVisionMessage] = useState('');
  const [visionResults, setVisionResults] = useState([]);
  const [editingMediaId, setEditingMediaId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState('');

  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');

  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteUrlMessage, setInviteUrlMessage] = useState('');
  const [profileForm, setProfileForm] = useState({ name: '', email: '', password: '' });
  const [profileMessage, setProfileMessage] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [integrationForm, setIntegrationForm] = useState({
    barcodePreset: 'upcitemdb',
    barcodeProvider: 'upcitemdb',
    barcodeApiUrl: '',
    barcodeApiKey: '',
    barcodeApiKeyHeader: 'x-api-key',
    barcodeQueryParam: 'upc',
    clearBarcodeApiKey: false,
    visionPreset: 'ocrspace',
    visionProvider: 'ocrspace',
    visionApiUrl: '',
    visionApiKey: '',
    visionApiKeyHeader: 'apikey',
    clearVisionApiKey: false,
    tmdbPreset: 'tmdb',
    tmdbProvider: 'tmdb',
    tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKey: '',
    tmdbApiKeyHeader: '',
    tmdbApiKeyQueryParam: 'api_key',
    clearTmdbApiKey: false
  });
  const [integrationMeta, setIntegrationMeta] = useState({
    barcodeApiKeySet: false,
    barcodeApiKeyMasked: '',
    visionApiKeySet: false,
    visionApiKeyMasked: '',
    tmdbApiKeySet: false,
    tmdbApiKeyMasked: ''
  });
  const [integrationMessage, setIntegrationMessage] = useState('');
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationTab, setIntegrationTab] = useState('barcode');
  const [integrationTestLoading, setIntegrationTestLoading] = useState('');
  const [integrationTestMessage, setIntegrationTestMessage] = useState('');
  const [barcodeTestUpc, setBarcodeTestUpc] = useState('012569828708');
  const [visionTestImageUrl, setVisionTestImageUrl] = useState('https://upload.wikimedia.org/wikipedia/en/c/c1/The_Matrix_Poster.jpg');
  const [tmdbTestTitle, setTmdbTestTitle] = useState('The Matrix');
  const [tmdbTestYear, setTmdbTestYear] = useState('1999');
  const [integrationStatus, setIntegrationStatus] = useState({
    barcode: 'unknown',
    vision: 'unknown',
    tmdb: 'unknown'
  });
  const [generalSettings, setGeneralSettings] = useState({
    theme: 'system',
    density: 'comfortable'
  });
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsMessage, setGeneralSettingsMessage] = useState('');

  const isAdmin = user?.role === 'admin';
  const isLibraryTab = activeTab === 'library' || activeTab === 'library-add';
  const isAdminSubtab = activeTab === 'admin-integrations' || activeTab === 'admin-settings' || activeTab === 'admin-users';
  const editingItem = mediaItems.find((item) => item.id === editingMediaId) || null;
  const detailMedia = mediaItems.find((item) => item.id === detailMediaId) || null;
  const pageTitle = useMemo(() => {
    if (route === 'register') return 'Create your account';
    if (route === 'dashboard') return 'Media dashboard';
    return 'Welcome back';
  }, [route]);

  const apiCall = async (method, path, data, config = {}) => {
    const headers = { ...(config.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await axios({
      method,
      url: `${API_URL}${path}`,
      data,
      ...config,
      headers
    });
    return response.data;
  };

  const applyDisplaySettings = (theme, density) => {
    const themeClass = `theme-${theme || 'system'}`;
    const densityClass = `density-${density || 'comfortable'}`;
    document.body.classList.remove('theme-system', 'theme-light', 'theme-dark');
    document.body.classList.remove('density-comfortable', 'density-compact');
    document.body.classList.add(themeClass);
    document.body.classList.add(densityClass);
  };

  const clearAuthMessages = () => {
    setAuthError('');
    setAuthSuccess('');
  };

  const clearMediaMessages = () => {
    setMediaError('');
    setMediaSubmitMessage('');
    setCoverUploadMessage('');
    setBarcodeLookupMessage('');
    setVisionMessage('');
    setEditMessage('');
  };

  const navigate = (nextRoute) => {
    const path = nextRoute === 'register' ? '/register' : nextRoute === 'dashboard' ? '/dashboard' : '/login';
    window.history.pushState({}, '', path);
    setRoute(nextRoute);
    clearAuthMessages();
  };

  const closeSidebarForMobile = () => {
    if (isMobileNav) setSidebarOpen(false);
  };

  const selectTab = (nextTab) => {
    setActiveTab(nextTab);
    closeSidebarForMobile();
  };

  const hydrateSession = (nextToken, nextUser) => {
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken('');
    setUser(null);
    setMediaItems([]);
    setDetailMediaId(null);
    setUsers([]);
    setInvites([]);
    setAuthEmail('');
    setAuthPassword('');
    setAuthInviteToken('');
    setAuthName('');
    navigate('login');
  };

  const loadMe = async () => {
    if (!token) return;
    try {
      const me = await apiCall('get', '/profile');
      setUser(me);
      setProfileForm((prev) => ({
        ...prev,
        name: me.name || '',
        email: me.email || '',
        password: ''
      }));
      localStorage.setItem(USER_KEY, JSON.stringify(me));
    } catch (_) {
      logout();
    }
  };

  const loadIntegrationSettings = async () => {
    try {
      const data = await apiCall('get', '/admin/settings/integrations');
      setIntegrationForm((prev) => ({
        ...prev,
        barcodePreset: data.barcodePreset || 'upcitemdb',
        barcodeProvider: data.barcodeProvider || '',
        barcodeApiUrl: data.barcodeApiUrl || '',
        barcodeApiKey: '',
        barcodeApiKeyHeader: data.barcodeApiKeyHeader || 'x-api-key',
        barcodeQueryParam: data.barcodeQueryParam || 'upc',
        clearBarcodeApiKey: false,
        visionPreset: data.visionPreset || 'ocrspace',
        visionProvider: data.visionProvider || '',
        visionApiUrl: data.visionApiUrl || '',
        visionApiKey: '',
        visionApiKeyHeader: data.visionApiKeyHeader || 'apikey',
        clearVisionApiKey: false,
        tmdbPreset: data.tmdbPreset || 'tmdb',
        tmdbProvider: data.tmdbProvider || '',
        tmdbApiUrl: data.tmdbApiUrl || '',
        tmdbApiKey: '',
        tmdbApiKeyHeader: data.tmdbApiKeyHeader || '',
        tmdbApiKeyQueryParam: data.tmdbApiKeyQueryParam || 'api_key',
        clearTmdbApiKey: false
      }));
      setIntegrationMeta({
        barcodeApiKeySet: Boolean(data.barcodeApiKeySet),
        barcodeApiKeyMasked: data.barcodeApiKeyMasked || '',
        visionApiKeySet: Boolean(data.visionApiKeySet),
        visionApiKeyMasked: data.visionApiKeyMasked || '',
        tmdbApiKeySet: Boolean(data.tmdbApiKeySet),
        tmdbApiKeyMasked: data.tmdbApiKeyMasked || ''
      });
      setIntegrationStatus({
        barcode: data.barcodeApiKeySet ? 'configured' : 'missing',
        vision: data.visionApiKeySet ? 'configured' : 'missing',
        tmdb: data.tmdbApiKeySet ? 'configured' : 'missing'
      });
    } catch (error) {
      setIntegrationMessage(error.response?.data?.error || 'Failed to load integration settings');
    }
  };

  const loadGeneralSettings = async () => {
    try {
      const data = await apiCall('get', '/settings/general');
      const theme = data.theme || 'system';
      const density = data.density || 'comfortable';
      setGeneralSettings({ theme, density });
      applyDisplaySettings(theme, density);
    } catch (_) {
      applyDisplaySettings('system', 'comfortable');
    }
  };

  const applyBarcodePreset = (presetName) => {
    const preset = BARCODE_PRESETS[presetName] || BARCODE_PRESETS.custom;
    setIntegrationForm((prev) => ({ ...prev, ...preset }));
  };

  const applyVisionPreset = (presetName) => {
    const preset = VISION_PRESETS[presetName] || VISION_PRESETS.custom;
    setIntegrationForm((prev) => ({ ...prev, ...preset }));
  };

  const applyTmdbPreset = (presetName) => {
    const preset = TMDB_PRESETS[presetName] || TMDB_PRESETS.custom;
    setIntegrationForm((prev) => ({ ...prev, ...preset }));
  };

  const loadMedia = async () => {
    setMediaLoading(true);
    setMediaError('');
    try {
      const params = new URLSearchParams();
      if (librarySearch.trim()) params.set('search', librarySearch.trim());
      if (libraryFormat && libraryFormat !== 'all') params.set('format', libraryFormat);
      const query = params.toString();
      const data = await apiCall('get', `/media${query ? `?${query}` : ''}`);
      setMediaItems(data);
    } catch (error) {
      setMediaError(error.response?.data?.error || 'Failed to load media');
    } finally {
      setMediaLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    setUsersError('');
    try {
      const data = await apiCall('get', '/users');
      setUsers(data);
    } catch (error) {
      setUsersError(error.response?.data?.error || 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  const loadInvites = async () => {
    if (!isAdmin) return;
    setInvitesLoading(true);
    setInvitesError('');
    try {
      const data = await apiCall('get', '/invites');
      setInvites(data);
    } catch (error) {
      setInvitesError(error.response?.data?.error || 'Failed to load invites');
    } finally {
      setInvitesLoading(false);
    }
  };

  useEffect(() => {
    const syncRoute = () => {
      const nextRoute = routeFromPath(window.location.pathname);
      if (nextRoute === 'dashboard' && !localStorage.getItem(TOKEN_KEY)) {
        window.history.replaceState({}, '', '/login');
        setRoute('login');
        return;
      }
      setRoute(nextRoute);
      clearAuthMessages();
    };

    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 900;
      setIsMobileNav(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (route === 'dashboard' && !token) {
      window.history.replaceState({}, '', '/login');
      setRoute('login');
    }
  }, [route, token]);

  useEffect(() => {
    if (route !== 'register') return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite') || '';
    const email = params.get('email') || '';
    if (invite) setAuthInviteToken(invite);
    if (email) setAuthEmail(email);
  }, [route]);

  useEffect(() => {
    if (route === 'dashboard' && token) {
      loadMe();
      loadMedia();
      loadGeneralSettings();
      if (isAdmin) {
        loadIntegrationSettings();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, token, isAdmin]);

  useEffect(() => {
    if (route === 'dashboard' && token && isAdmin) {
      loadUsers();
      loadInvites();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, token, isAdmin]);

  useEffect(() => {
    if (activeTab === 'admin-integrations') {
      setIntegrationTab('barcode');
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'admin-integrations' && isAdmin) {
      loadIntegrationSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  useEffect(() => {
    applyDisplaySettings(generalSettings.theme, generalSettings.density);
  }, [generalSettings.theme, generalSettings.density]);

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    clearAuthMessages();
    try {
      const endpoint = route === 'register' ? '/auth/register' : '/auth/login';
      const payload = route === 'register'
        ? {
            name: authName,
            email: authEmail,
            password: authPassword,
            inviteToken: authInviteToken || undefined
          }
        : { email: authEmail, password: authPassword };
      const data = await apiCall('post', endpoint, payload);
      hydrateSession(data.token, data.user);
      setAuthPassword('');
      setAuthInviteToken('');
      setAuthSuccess(route === 'register' ? 'Registration complete.' : 'Login successful.');
      navigate('dashboard');
    } catch (error) {
      setAuthError(error.response?.data?.error || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const searchTmdb = async () => {
    if (!mediaForm.title.trim()) return;
    setTmdbLoading(true);
    setMediaSubmitMessage('');
    try {
      const results = await apiCall('post', '/media/search-tmdb', {
        title: mediaForm.title.trim(),
        year: mediaForm.year || undefined
      });
      setTmdbResults(results || []);
    } catch (error) {
      setMediaSubmitMessage(error.response?.data?.error || 'TMDB search failed');
    } finally {
      setTmdbLoading(false);
    }
  };

  const selectTmdbResult = (result) => {
    const genres = (result.genre_ids || []).map((id) => TMDB_GENRE_MAP[id]).filter(Boolean).join(', ');
    setMediaForm((prev) => ({
      ...prev,
      title: result.title || prev.title,
      original_title: result.original_title || prev.original_title,
      release_date: result.release_date || prev.release_date,
      year: result.release_date ? String(result.release_date).slice(0, 4) : prev.year,
      genre: genres || prev.genre,
      rating: result.vote_average ? Number(result.vote_average).toFixed(1) : prev.rating,
      overview: result.overview || prev.overview,
      tmdb_id: result.id || prev.tmdb_id,
      poster_path: result.poster_path || prev.poster_path,
      backdrop_path: result.backdrop_path || prev.backdrop_path
    }));
    setMediaSubmitMessage('TMDB details applied.');
  };

  const applyLookupMatch = (match) => {
    const tmdb = match.tmdb || null;
    const genres = (tmdb?.genre_ids || []).map((id) => TMDB_GENRE_MAP[id]).filter(Boolean).join(', ');
    setMediaForm((prev) => ({
      ...prev,
      title: tmdb?.title || match.title || prev.title,
      original_title: tmdb?.original_title || prev.original_title,
      release_date: tmdb?.release_date || prev.release_date,
      year: tmdb?.release_date ? String(tmdb.release_date).slice(0, 4) : prev.year,
      genre: genres || prev.genre,
      overview: tmdb?.overview || match.description || prev.overview,
      tmdb_id: tmdb?.id || prev.tmdb_id,
      poster_path: tmdb?.poster_path || match.image || prev.poster_path,
      backdrop_path: tmdb?.backdrop_path || prev.backdrop_path
    }));
    setMediaSubmitMessage('Lookup details applied to form.');
  };

  const lookupUpc = async () => {
    if (!mediaForm.upc.trim()) {
      setBarcodeLookupMessage('Enter a UPC first.');
      return;
    }
    setBarcodeLookupLoading(true);
    setBarcodeLookupMessage('');
    setBarcodeLookupResults([]);
    try {
      const data = await apiCall('post', '/media/lookup-upc', { upc: mediaForm.upc.trim() });
      setBarcodeLookupResults(data.matches || []);
      setBarcodeLookupMessage((data.matches || []).length ? 'UPC lookup completed.' : 'No UPC matches found.');
    } catch (error) {
      setBarcodeLookupMessage(
        error.response?.data?.detail
          || error.response?.data?.error
          || 'UPC lookup failed'
      );
    } finally {
      setBarcodeLookupLoading(false);
    }
  };

  const uploadCover = async () => {
    if (!coverFile) return;
    const body = new FormData();
    body.append('cover', coverFile);
    try {
      const data = await apiCall('post', '/media/upload-cover', body, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMediaForm((prev) => ({ ...prev, poster_path: data.path }));
      setCoverUploadMessage('Cover uploaded. Save media to persist.');
    } catch (error) {
      setCoverUploadMessage(error.response?.data?.error || 'Cover upload failed');
    }
  };

  const recognizeCover = async () => {
    if (!coverFile) {
      setVisionMessage('Choose a cover image first.');
      return;
    }
    setVisionLoading(true);
    setVisionMessage('');
    setVisionResults([]);
    const body = new FormData();
    body.append('cover', coverFile);
    try {
      const data = await apiCall('post', '/media/recognize-cover', body, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setVisionResults(data.tmdbMatches || []);
      setVisionMessage((data.tmdbMatches || []).length ? 'Cover recognition completed.' : 'No likely matches found.');
    } catch (error) {
      setVisionMessage(
        error.response?.data?.detail
          || error.response?.data?.error
          || 'Cover recognition failed'
      );
    } finally {
      setVisionLoading(false);
    }
  };

  const submitMedia = async (event) => {
    event.preventDefault();
    setMediaSubmitting(true);
    clearMediaMessages();
    try {
      await apiCall('post', '/media', {
        ...mediaForm,
        release_date: mediaForm.release_date || null,
        year: mediaForm.year ? Number(mediaForm.year) : null,
        rating: mediaForm.rating ? Number(mediaForm.rating) : null,
        user_rating: mediaForm.user_rating ? Number(mediaForm.user_rating) : null,
        runtime: mediaForm.runtime ? Number(mediaForm.runtime) : null,
        tmdb_id: mediaForm.tmdb_id ? Number(mediaForm.tmdb_id) : null
      });
      setMediaSubmitMessage('Media added successfully.');
      setMediaForm(DEFAULT_MEDIA_FORM);
      setTmdbResults([]);
      setCoverFile(null);
      loadMedia();
      setActiveTab('library');
    } catch (error) {
      setMediaSubmitMessage(error.response?.data?.error || 'Failed to save media');
    } finally {
      setMediaSubmitting(false);
    }
  };

  const removeMedia = async (id) => {
    try {
      await apiCall('delete', `/media/${id}`);
      setMediaItems((prev) => prev.filter((item) => item.id !== id));
      if (detailMediaId === id) setDetailMediaId(null);
      return true;
    } catch (error) {
      setMediaError(error.response?.data?.error || 'Failed to delete media');
      return false;
    }
  };

  const startEditMedia = (item) => {
    setDetailMediaId(null);
    setEditingMediaId(item.id);
    setEditForm({
      title: item.title || '',
      original_title: item.original_title || '',
      release_date: item.release_date ? String(item.release_date).slice(0, 10) : '',
      year: item.year || '',
      format: item.format || 'Blu-ray',
      genre: item.genre || '',
      director: item.director || '',
      rating: item.rating || '',
      user_rating: item.user_rating || 0,
      runtime: item.runtime || '',
      upc: item.upc || '',
      location: item.location || '',
      notes: item.notes || ''
    });
    setEditMessage('');
  };

  const cancelEditMedia = () => {
    setEditingMediaId(null);
    setEditForm(null);
    setEditMessage('');
  };

  const saveEditMedia = async (id) => {
    if (!editForm) return;
    setEditSaving(true);
    setEditMessage('');
    try {
      const payload = {
        ...editForm,
        release_date: editForm.release_date || null,
        year: editForm.year ? Number(editForm.year) : null,
        rating: editForm.rating ? Number(editForm.rating) : null,
        user_rating: editForm.user_rating ? Number(editForm.user_rating) : null,
        runtime: editForm.runtime ? Number(editForm.runtime) : null
      };
      const updated = await apiCall('patch', `/media/${id}`, payload);
      setMediaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      setEditMessage('Media updated.');
      setEditingMediaId(null);
      setEditForm(null);
    } catch (error) {
      setEditMessage(error.response?.data?.error || 'Failed to update media');
    } finally {
      setEditSaving(false);
    }
  };

  const deleteFromEditScreen = async () => {
    if (!editingItem) return;
    const confirmed = window.confirm('Delete this media item? This cannot be undone.');
    if (!confirmed) return;
    const ok = await removeMedia(editingItem.id);
    if (ok) cancelEditMedia();
  };

  const confirmDeleteFromLibrary = async (id) => {
    const confirmed = window.confirm('Delete this media item? This cannot be undone.');
    if (!confirmed) return;
    await removeMedia(id);
  };

  const updateUserRole = async (id, role) => {
    try {
      const updated = await apiCall('patch', `/users/${id}/role`, { role });
      setUsers((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...updated } : entry)));
    } catch (error) {
      setUsersError(error.response?.data?.error || 'Failed to update role');
    }
  };

  const removeUser = async (id) => {
    try {
      await apiCall('delete', `/users/${id}`);
      setUsers((prev) => prev.filter((entry) => entry.id !== id));
    } catch (error) {
      setUsersError(error.response?.data?.error || 'Failed to delete user');
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    setInviteMessage('');
    try {
      const data = await apiCall('post', '/invites', { email: inviteEmail });
      const url = `${window.location.origin}/register?invite=${encodeURIComponent(data.token)}&email=${encodeURIComponent(data.email)}`;
      setInviteMessage(`Invite created for ${data.email}`);
      setInviteUrlMessage(url);
      setInviteEmail('');
      loadInvites();
    } catch (error) {
      setInviteMessage(error.response?.data?.error || 'Failed to create invite');
    }
  };

  const copyInviteValue = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setInviteMessage('Copied to clipboard.');
    } catch (_) {
      setInviteMessage(value);
    }
  };

  const saveGeneralSettings = async (event) => {
    event.preventDefault();
    setGeneralSettingsSaving(true);
    setGeneralSettingsMessage('');
    try {
      const updated = await apiCall('put', '/admin/settings/general', generalSettings);
      const theme = updated.theme || 'system';
      const density = updated.density || 'comfortable';
      setGeneralSettings({ theme, density });
      applyDisplaySettings(theme, density);
      setGeneralSettingsMessage('Settings saved.');
    } catch (error) {
      setGeneralSettingsMessage(error.response?.data?.error || 'Failed to save settings');
    } finally {
      setGeneralSettingsSaving(false);
    }
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileMessage('');
    try {
      const payload = {
        name: profileForm.name,
        email: profileForm.email
      };
      if (profileForm.password) payload.password = profileForm.password;
      const updated = await apiCall('patch', '/profile', payload);
      setUser(updated);
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      setProfileForm((prev) => ({ ...prev, password: '' }));
      setProfileMessage('Profile updated.');
    } catch (error) {
      setProfileMessage(error.response?.data?.error || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const getProviderPortalUrl = (section) => {
    if (section === 'barcode') {
      if (integrationForm.barcodePreset === 'barcodelookup') return 'https://www.barcodelookup.com/api';
      if (integrationForm.barcodePreset === 'upcitemdb') return 'https://www.upcitemdb.com/api/explorer';
      return 'https://www.google.com/search?q=barcode+api+key';
    }
    if (section === 'vision') {
      if (integrationForm.visionPreset === 'ocrspace') return 'https://ocr.space/ocrapi';
      return 'https://www.google.com/search?q=vision+api+key';
    }
    if (integrationForm.tmdbPreset === 'tmdb') return 'https://www.themoviedb.org/settings/api';
    return 'https://www.google.com/search?q=tmdb+api+key';
  };

  const saveIntegrationSection = async (section) => {
    setIntegrationSaving(true);
    setIntegrationMessage('');
    try {
      const payload = {};
      if (section === 'barcode') {
        payload.barcodePreset = integrationForm.barcodePreset;
        payload.barcodeProvider = integrationForm.barcodeProvider;
        payload.barcodeApiUrl = integrationForm.barcodeApiUrl;
        payload.barcodeApiKeyHeader = integrationForm.barcodeApiKeyHeader;
        payload.barcodeQueryParam = integrationForm.barcodeQueryParam;
        payload.clearBarcodeApiKey = integrationForm.clearBarcodeApiKey;
        if (integrationForm.barcodeApiKey) payload.barcodeApiKey = integrationForm.barcodeApiKey;
      } else if (section === 'vision') {
        payload.visionPreset = integrationForm.visionPreset;
        payload.visionProvider = integrationForm.visionProvider;
        payload.visionApiUrl = integrationForm.visionApiUrl;
        payload.visionApiKeyHeader = integrationForm.visionApiKeyHeader;
        payload.clearVisionApiKey = integrationForm.clearVisionApiKey;
        if (integrationForm.visionApiKey) payload.visionApiKey = integrationForm.visionApiKey;
      } else {
        payload.tmdbPreset = integrationForm.tmdbPreset;
        payload.tmdbProvider = integrationForm.tmdbProvider;
        payload.tmdbApiUrl = integrationForm.tmdbApiUrl;
        payload.tmdbApiKeyHeader = integrationForm.tmdbApiKeyHeader;
        payload.tmdbApiKeyQueryParam = integrationForm.tmdbApiKeyQueryParam;
        payload.clearTmdbApiKey = integrationForm.clearTmdbApiKey;
        if (integrationForm.tmdbApiKey) payload.tmdbApiKey = integrationForm.tmdbApiKey;
      }

      const updated = await apiCall('put', '/admin/settings/integrations', payload);
      setIntegrationMeta({
        barcodeApiKeySet: Boolean(updated.barcodeApiKeySet),
        barcodeApiKeyMasked: updated.barcodeApiKeyMasked || '',
        visionApiKeySet: Boolean(updated.visionApiKeySet),
        visionApiKeyMasked: updated.visionApiKeyMasked || '',
        tmdbApiKeySet: Boolean(updated.tmdbApiKeySet),
        tmdbApiKeyMasked: updated.tmdbApiKeyMasked || ''
      });
      setIntegrationForm((prev) => ({
        ...prev,
        barcodeApiKey: section === 'barcode' ? '' : prev.barcodeApiKey,
        visionApiKey: section === 'vision' ? '' : prev.visionApiKey,
        tmdbApiKey: section === 'tmdb' ? '' : prev.tmdbApiKey,
        clearBarcodeApiKey: section === 'barcode' ? false : prev.clearBarcodeApiKey,
        clearVisionApiKey: section === 'vision' ? false : prev.clearVisionApiKey,
        clearTmdbApiKey: section === 'tmdb' ? false : prev.clearTmdbApiKey
      }));
      setIntegrationStatus({
        barcode: updated.barcodeApiKeySet ? 'configured' : 'missing',
        vision: updated.visionApiKeySet ? 'configured' : 'missing',
        tmdb: updated.tmdbApiKeySet ? 'configured' : 'missing'
      });
      setIntegrationMessage(`${section.toUpperCase()} settings saved.`);
    } catch (error) {
      setIntegrationMessage(error.response?.data?.error || `Failed to save ${section} settings`);
    } finally {
      setIntegrationSaving(false);
    }
  };

  const renderStatusBadge = (status) => {
    const labelMap = {
      ok: 'Connected',
      auth_failed: 'Auth Failed',
      configured: 'Configured',
      missing: 'Missing Key',
      error: 'Error',
      unknown: 'Unknown'
    };
    return (
      <span className={`status-badge ${status || 'unknown'}`}>
        {labelMap[status] || 'Unknown'}
      </span>
    );
  };

  const isIntegrationConfigured = (section) => {
    if (section === 'barcode') return integrationMeta.barcodeApiKeySet;
    if (section === 'vision') return integrationMeta.visionApiKeySet;
    return integrationMeta.tmdbApiKeySet;
  };

  const testBarcodeIntegration = async () => {
    setIntegrationTestLoading('barcode');
    setIntegrationTestMessage('');
    try {
      const result = await apiCall('post', '/admin/settings/integrations/test-barcode', { upc: barcodeTestUpc });
      setIntegrationStatus((prev) => ({ ...prev, barcode: result.authenticated ? 'ok' : 'auth_failed' }));
      setIntegrationTestMessage(
        `Barcode test: ${result.authenticated ? 'OK' : 'AUTH FAILED'} (status ${result.status}) - ${result.detail}`
      );
    } catch (error) {
      setIntegrationStatus((prev) => ({ ...prev, barcode: 'error' }));
      setIntegrationTestMessage(error.response?.data?.detail || error.response?.data?.error || 'Barcode test failed');
    } finally {
      setIntegrationTestLoading('');
    }
  };

  const testVisionIntegration = async () => {
    setIntegrationTestLoading('vision');
    setIntegrationTestMessage('');
    try {
      const result = await apiCall('post', '/admin/settings/integrations/test-vision', { imageUrl: visionTestImageUrl });
      setIntegrationStatus((prev) => ({ ...prev, vision: result.authenticated ? 'ok' : 'auth_failed' }));
      setIntegrationTestMessage(
        `Vision test: ${result.authenticated ? 'OK' : 'AUTH FAILED'} (status ${result.status}) - ${result.detail}`
      );
    } catch (error) {
      setIntegrationStatus((prev) => ({ ...prev, vision: 'error' }));
      setIntegrationTestMessage(error.response?.data?.detail || error.response?.data?.error || 'Vision test failed');
    } finally {
      setIntegrationTestLoading('');
    }
  };

  const testTmdbIntegration = async () => {
    setIntegrationTestLoading('tmdb');
    setIntegrationTestMessage('');
    try {
      const result = await apiCall('post', '/admin/settings/integrations/test-tmdb', {
        title: tmdbTestTitle,
        year: tmdbTestYear
      });
      setIntegrationStatus((prev) => ({ ...prev, tmdb: result.authenticated ? 'ok' : 'auth_failed' }));
      setIntegrationTestMessage(
        `TMDB test: ${result.authenticated ? 'OK' : 'AUTH FAILED'} (status ${result.status}) - ${result.detail}`
      );
    } catch (error) {
      setIntegrationStatus((prev) => ({ ...prev, tmdb: 'error' }));
      setIntegrationTestMessage(error.response?.data?.detail || error.response?.data?.error || 'TMDB test failed');
    } finally {
      setIntegrationTestLoading('');
    }
  };

  if (route !== 'dashboard') {
    return (
      <div className="app-shell">
        <div className="card auth-card">
          <h1>MediaVault</h1>
          <p className="subtitle">{pageTitle}</p>
          <div className="tabs">
            <button type="button" className={route === 'login' ? 'active' : ''} onClick={() => navigate('login')}>
              Login
            </button>
            <button type="button" className={route === 'register' ? 'active' : ''} onClick={() => navigate('register')}>
              Register
            </button>
          </div>
          <form onSubmit={submitAuth}>
            {route === 'register' && (
              <label>
                Name
                <input value={authName} onChange={(event) => setAuthName(event.target.value)} required />
              </label>
            )}
            <label>
              Email
              <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required />
            </label>
            {route === 'register' && (
              <label>
                Invite token
                <input
                  value={authInviteToken}
                  onChange={(event) => setAuthInviteToken(event.target.value)}
                  placeholder="Required after initial bootstrap user"
                />
              </label>
            )}
            <button className="primary" type="submit" disabled={authLoading}>
              {authLoading ? 'Working...' : route === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          {authError && <p className="message error">{authError}</p>}
          {authSuccess && <p className="message success">{authSuccess}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {isMobileNav && sidebarOpen && (
        <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar card ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>MediaVault</h2>
          {!isMobileNav && (
            <button type="button" className="sidebar-toggle secondary small" onClick={() => setSidebarCollapsed((prev) => !prev)}>
              {sidebarCollapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          {isMobileNav && (
            <button type="button" className="sidebar-toggle secondary small" onClick={() => setSidebarOpen(false)}>
              Close
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <button type="button" className={isLibraryTab ? 'active' : ''} onClick={() => selectTab('library')}>
            <span>Library</span>
          </button>

          <div className="sidebar-divider" />

          {isAdmin && (
            <div className="sidebar-admin">
              <button
                type="button"
                className={isAdminSubtab ? 'active' : ''}
                onClick={() => {
                  setAdminMenuOpen((prev) => !prev);
                }}
              >
                <span>Admin Settings</span>
              </button>
              {adminMenuOpen && (
                <div className="sidebar-subnav">
                  <button type="button" className={activeTab === 'admin-integrations' ? 'active' : ''} onClick={() => selectTab('admin-integrations')}>
                    <span>Integrations</span>
                  </button>
                  <button type="button" className={activeTab === 'admin-settings' ? 'active' : ''} onClick={() => selectTab('admin-settings')}>
                    <span>Settings</span>
                  </button>
                  <button type="button" className={activeTab === 'admin-users' ? 'active' : ''} onClick={() => selectTab('admin-users')}>
                    <span>Users</span>
                  </button>
                </div>
              )}
            </div>
          )}

          <button type="button" className={activeTab === 'profile' ? 'active' : ''} onClick={() => selectTab('profile')}>
            <span>Profile</span>
          </button>
        </nav>
      </aside>

      <main className="dashboard-main">
        <header className="topbar card">
          <div className="topbar-title">
            {isMobileNav && (
              <button type="button" className="hamburger-btn" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
                <span />
                <span />
              </button>
            )}
            <div>
              <h1>MediaVault</h1>
              <p className="subtitle">{user?.name} ({user?.role})</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary" onClick={loadMedia}>Refresh</button>
            <button type="button" className="secondary" onClick={logout}>Logout</button>
          </div>
        </header>

      {activeTab === 'library' && (
        <section className="card section">
          {editingItem && editForm ? (
            <div className="media-edit-screen">
              <div className="section-head">
                <h2>Edit Media</h2>
              </div>
              <p className="subtitle">{editingItem.title}</p>
              <div className="media-edit-layout">
                <div className="media-edit-poster">
                  {posterUrl(editingItem.poster_path) ? (
                    <img className="media-image" src={posterUrl(editingItem.poster_path)} alt={editingItem.title} />
                  ) : (
                    <div className="media-placeholder">No cover</div>
                  )}
                </div>
                <form className="media-edit-form" onSubmit={(event) => { event.preventDefault(); saveEditMedia(editingItem.id); }}>
                  <div className="media-edit-row row-1">
                    <label>
                      Title
                      <input value={editForm.title} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} />
                    </label>
                    <label>
                      Year
                      <input value={editForm.year} onChange={(event) => setEditForm((prev) => ({ ...prev, year: event.target.value }))} inputMode="numeric" />
                    </label>
                    <label>
                      Format
                      <select value={editForm.format} onChange={(event) => setEditForm((prev) => ({ ...prev, format: event.target.value }))}>
                        {MEDIA_FORMATS.map((format) => (
                          <option key={format} value={format}>{format}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="media-edit-row row-2">
                    <label>
                      Director
                      <input value={editForm.director} onChange={(event) => setEditForm((prev) => ({ ...prev, director: event.target.value }))} />
                    </label>
                    <label>
                      Genre
                      <input value={editForm.genre} onChange={(event) => setEditForm((prev) => ({ ...prev, genre: event.target.value }))} />
                    </label>
                    <label>
                      Rating
                      <input value={editForm.rating} onChange={(event) => setEditForm((prev) => ({ ...prev, rating: event.target.value }))} />
                    </label>
                    <label>
                      Runtime
                      <input value={editForm.runtime} onChange={(event) => setEditForm((prev) => ({ ...prev, runtime: event.target.value }))} inputMode="numeric" />
                    </label>
                  </div>
                  <div className="media-edit-row row-full">
                    <label>
                      Location
                      <input value={editForm.location} onChange={(event) => setEditForm((prev) => ({ ...prev, location: event.target.value }))} />
                    </label>
                  </div>
                  <div className="media-edit-row row-full">
                    <label>
                      Notes
                      <textarea rows="4" value={editForm.notes} onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))} />
                    </label>
                  </div>
                  <div className="media-edit-actions">
                    <button type="submit" className="primary small" disabled={editSaving}>
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="secondary small" onClick={cancelEditMedia}>Cancel</button>
                    <button type="button" className="danger small" onClick={deleteFromEditScreen}>Delete</button>
                  </div>
                </form>
              </div>
              {editMessage && <p className="message success">{editMessage}</p>}
            </div>
          ) : detailMedia ? (
            <div className="media-detail-screen">
              <div className="section-head">
                <h2>{detailMedia.title}</h2>
                <button type="button" className="secondary small" onClick={() => setDetailMediaId(null)}>
                  Back to library
                </button>
              </div>
              <div className="media-detail-layout">
                <div className="media-detail-poster">
                  {posterUrl(detailMedia.poster_path) ? (
                    <img className="media-image" src={posterUrl(detailMedia.poster_path)} alt={detailMedia.title} />
                  ) : (
                    <div className="media-placeholder">No cover</div>
                  )}
                </div>
                <div className="media-detail-content">
                  <div className="media-detail-grid">
                    <div><strong>TMDB ID:</strong> {detailMedia.tmdb_id || 'n/a'}</div>
                    <div><strong>Title:</strong> {detailMedia.title || 'n/a'}</div>
                    <div><strong>Original title:</strong> {detailMedia.original_title || 'n/a'}</div>
                    <div><strong>Release date:</strong> {detailMedia.release_date ? String(detailMedia.release_date).slice(0, 10) : 'n/a'}</div>
                    <div><strong>Genres:</strong> {detailMedia.genre || 'n/a'}</div>
                    <div><strong>TMDB rating:</strong> {detailMedia.rating ?? 'n/a'}</div>
                    <div className="full"><strong>Poster path:</strong> {detailMedia.poster_path || 'n/a'}</div>
                    <div className="full"><strong>Backdrop path:</strong> {detailMedia.backdrop_path || 'n/a'}</div>
                  </div>
                  <div className="media-detail-overview">
                    <strong>Overview</strong>
                    <p>{detailMedia.overview || 'No overview available.'}</p>
                  </div>
                  {posterUrl(detailMedia.backdrop_path) && (
                    <div className="media-detail-backdrop">
                      <strong>Backdrop</strong>
                      <img className="media-image" src={posterUrl(detailMedia.backdrop_path)} alt={`${detailMedia.title} backdrop`} />
                    </div>
                  )}
                  <div className="media-detail-user-rating">
                    <strong>Your rating</strong>
                    <StarRating value={detailMedia.user_rating || 0} readOnly />
                  </div>
                </div>
              </div>
              <div className="inline-controls">
                <button type="button" className="secondary small" onClick={() => startEditMedia(detailMedia)}>Edit</button>
                <button type="button" className="danger small" onClick={() => confirmDeleteFromLibrary(detailMedia.id)}>Delete</button>
              </div>
            </div>
          ) : (
            <>
              <div className="section-head library-head">
                <div className="library-title-group">
                  <h2>Library</h2>
                </div>
              </div>
              <div className="inline-controls library-search-controls">
                <input
                  placeholder="Search title/director"
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                />
                <button type="button" className="primary small" onClick={loadMedia}>Apply</button>
                <select value={libraryFormat} onChange={(event) => setLibraryFormat(event.target.value)}>
                  <option value="all">All formats</option>
                  {MEDIA_FORMATS.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </div>
              <div className="inline-controls library-view-controls">
                <div className="tabs inline library-view-toggle">
                  <button
                    type="button"
                    className={libraryViewMode === 'cards' ? 'active' : ''}
                    onClick={() => setLibraryViewMode('cards')}
                  >
                    Cards
                  </button>
                  <button
                    type="button"
                    className={libraryViewMode === 'list' ? 'active' : ''}
                    onClick={() => setLibraryViewMode('list')}
                  >
                    List
                  </button>
                </div>
                <button type="button" className="secondary small" onClick={() => setActiveTab('library-add')}>
                  Add media
                </button>
              </div>
              {mediaError && <p className="message error">{mediaError}</p>}
              {mediaLoading ? (
                <p>Loading media...</p>
              ) : libraryViewMode === 'cards' ? (
                <div className="media-grid">
                  {mediaItems.length === 0 && <p>No media records found.</p>}
                  {mediaItems.map((item) => (
                    <article
                      key={item.id}
                      className="media-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailMediaId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailMediaId(item.id);
                        }
                      }}
                    >
                      <div className="media-image-wrap">
                        {posterUrl(item.poster_path) ? (
                          <img className="media-image" src={posterUrl(item.poster_path)} alt={item.title} />
                        ) : (
                          <div className="media-placeholder">No cover</div>
                        )}
                      </div>
                      <div className="media-details">
                        <h3>{item.title}</h3>
                        <p>{item.year || 'Unknown year'} • {item.format || 'Unknown format'}</p>
                        {item.director && <p>Director: {item.director}</p>}
                        {item.upc && <p>UPC: {item.upc}</p>}
                        {item.location && <p>Location: {item.location}</p>}
                        {item.notes && <p>Notes: {item.notes}</p>}
                      </div>
                      <div className="inline-controls">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditMedia(item);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger small"
                          onClick={(event) => {
                            event.stopPropagation();
                            confirmDeleteFromLibrary(item.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="media-list">
                  {mediaItems.length === 0 && <p>No media records found.</p>}
                  {mediaItems.map((item) => (
                    <article
                      key={item.id}
                      className="media-list-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => setDetailMediaId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setDetailMediaId(item.id);
                        }
                      }}
                    >
                      <div className="media-list-poster">
                        {posterUrl(item.poster_path) ? (
                          <img className="media-image" src={posterUrl(item.poster_path)} alt={item.title} />
                        ) : (
                          <div className="media-placeholder">No cover</div>
                        )}
                      </div>
                      <div className="media-list-meta">
                        <h3>{item.title}</h3>
                        <p>{item.year || 'Unknown year'}</p>
                        <p>{item.format || 'Unknown format'}</p>
                      </div>
                      <div className="inline-controls">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEditMedia(item);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger small"
                          onClick={(event) => {
                            event.stopPropagation();
                            confirmDeleteFromLibrary(item.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'library-add' && (
        <section className="card section">
          <div className="section-head">
            <h2>Add Media</h2>
            <button type="button" className="secondary small" onClick={() => setActiveTab('library')}>
              Back to library
            </button>
          </div>
          <p className="subtitle">Add by title/year, UPC scan input, or cover upload + metadata.</p>
          <div className="tabs inline">
            <button type="button" className={addMode === 'title' ? 'active' : ''} onClick={() => setAddMode('title')}>Title/Year</button>
            <button type="button" className={addMode === 'upc' ? 'active' : ''} onClick={() => setAddMode('upc')}>UPC</button>
            <button type="button" className={addMode === 'cover' ? 'active' : ''} onClick={() => setAddMode('cover')}>Cover Upload</button>
          </div>

          <form onSubmit={submitMedia} className="form-grid">
            <label>
              Title
              <input
                value={mediaForm.title}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, title: event.target.value }))}
                required
              />
            </label>
            <label>
              Original title
              <input
                value={mediaForm.original_title}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, original_title: event.target.value }))}
              />
            </label>
            <label>
              Release date
              <input
                type="date"
                value={mediaForm.release_date}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, release_date: event.target.value }))}
              />
            </label>
            <label>
              Release year
              <input
                value={mediaForm.year}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, year: event.target.value }))}
                inputMode="numeric"
              />
            </label>
            <label>
              Format
              <select
                value={mediaForm.format}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, format: event.target.value }))}
              >
                {MEDIA_FORMATS.map((format) => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
            </label>
            {(addMode === 'upc' || addMode === 'cover') && (
              <label>
                UPC
                <input
                  value={mediaForm.upc}
                  onChange={(event) => setMediaForm((prev) => ({ ...prev, upc: event.target.value }))}
                  placeholder="Scanner-friendly input field"
                />
              </label>
            )}
            {addMode === 'upc' && (
              <button type="button" className="secondary small" onClick={lookupUpc} disabled={barcodeLookupLoading}>
                {barcodeLookupLoading ? 'Looking up UPC...' : 'Lookup UPC'}
              </button>
            )}
            {addMode === 'cover' && (
              <label>
                Cover image
                <input type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} />
              </label>
            )}
            {addMode === 'cover' && (
              <div className="inline-controls">
                <button type="button" className="secondary small" onClick={uploadCover} disabled={!coverFile}>
                  Upload cover
                </button>
                <button type="button" className="secondary small" onClick={recognizeCover} disabled={!coverFile || visionLoading}>
                  {visionLoading ? 'Recognizing...' : 'Recognize cover'}
                </button>
              </div>
            )}
            {coverUploadMessage && <p className="message success">{coverUploadMessage}</p>}
            {barcodeLookupMessage && <p className="message success">{barcodeLookupMessage}</p>}
            {visionMessage && <p className="message success">{visionMessage}</p>}

            <label>
              Genres
              <input
                value={mediaForm.genre}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, genre: event.target.value }))}
              />
            </label>
            <label>
              Director
              <input
                value={mediaForm.director}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, director: event.target.value }))}
              />
            </label>
            <label>
              TMDB rating
              <input
                value={mediaForm.rating}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, rating: event.target.value }))}
                inputMode="decimal"
              />
            </label>
            <label className="full">
              Your rating
              <StarRating value={mediaForm.user_rating || 0} onChange={(next) => setMediaForm((prev) => ({ ...prev, user_rating: next }))} />
            </label>
            <label>
              Runtime (min)
              <input
                value={mediaForm.runtime}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, runtime: event.target.value }))}
                inputMode="numeric"
              />
            </label>
            <label>
              Storage location
              <input
                value={mediaForm.location}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, location: event.target.value }))}
              />
            </label>
            <label className="full">
              Notes
              <textarea
                rows="3"
                value={mediaForm.notes}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>
            <label className="full">
              TMDB ID
              <input
                value={mediaForm.tmdb_id}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, tmdb_id: event.target.value }))}
              />
            </label>
            <label className="full">
              Overview
              <textarea
                rows="3"
                value={mediaForm.overview}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, overview: event.target.value }))}
              />
            </label>
            <label className="full">
              Poster path
              <input
                value={mediaForm.poster_path}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, poster_path: event.target.value }))}
              />
            </label>
            <label className="full">
              Backdrop path
              <input
                value={mediaForm.backdrop_path}
                onChange={(event) => setMediaForm((prev) => ({ ...prev, backdrop_path: event.target.value }))}
              />
            </label>
            <div className="inline-controls full">
              <button type="button" className="secondary small" onClick={searchTmdb} disabled={tmdbLoading}>
                {tmdbLoading ? 'Searching TMDB...' : 'Search TMDB'}
              </button>
              <button className="primary small" type="submit" disabled={mediaSubmitting}>
                {mediaSubmitting ? 'Saving...' : 'Save media'}
              </button>
            </div>
          </form>

          {mediaSubmitMessage && <p className="message success">{mediaSubmitMessage}</p>}

          {barcodeLookupResults.length > 0 && (
            <div className="tmdb-results">
              <h3>UPC matches</h3>
              {barcodeLookupResults.map((match, index) => (
                <button type="button" className="tmdb-item" key={`${match.title || 'match'}-${index}`} onClick={() => applyLookupMatch(match)}>
                  <span>{match.tmdb?.title || match.title || 'Unknown item'}</span>
                  <span>Use</span>
                </button>
              ))}
            </div>
          )}

          {tmdbResults.length > 0 && (
            <div className="tmdb-results">
              <h3>TMDB matches</h3>
              {tmdbResults.slice(0, 8).map((result) => (
                <button type="button" className="tmdb-item" key={result.id} onClick={() => selectTmdbResult(result)}>
                  <span>{result.title} ({(result.release_date || '').slice(0, 4) || 'n/a'})</span>
                  <span>Use</span>
                </button>
              ))}
            </div>
          )}

          {visionResults.length > 0 && (
            <div className="tmdb-results">
              <h3>Cover recognition matches</h3>
              {visionResults.slice(0, 8).map((result) => (
                <button type="button" className="tmdb-item" key={`vision-${result.id}`} onClick={() => selectTmdbResult(result)}>
                  <span>{result.title} ({(result.release_date || '').slice(0, 4) || 'n/a'})</span>
                  <span>Use</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'profile' && (
        <section className="card section">
          <h2>My Profile</h2>
          <form onSubmit={saveProfile} className="form-grid">
            <label>
              Name
              <input
                value={profileForm.name}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={profileForm.email}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, email: event.target.value }))}
              />
            </label>
            <label className="full">
              New password
              <input
                type="password"
                value={profileForm.password}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Leave empty to keep existing password"
              />
            </label>
            <div className="inline-controls full">
              <button type="submit" className="primary small" disabled={profileSaving}>
                {profileSaving ? 'Saving profile...' : 'Save profile'}
              </button>
            </div>
          </form>
          {profileMessage && <p className="message success">{profileMessage}</p>}
        </section>
      )}

      {activeTab === 'admin-integrations' && isAdmin && (
        <section className="card section">
          <h2>Admin Integrations</h2>
          <p className="subtitle">Global provider settings used by all users for barcode, vision, and TMDB.</p>
          <div className="integration-tabs">
            <button
              type="button"
              className={integrationTab === 'barcode' ? 'active' : ''}
              onClick={() => setIntegrationTab('barcode')}
            >
              Barcode <span className={`integration-check ${isIntegrationConfigured('barcode') ? 'configured' : 'missing'}`}>✓</span>
            </button>
            <button
              type="button"
              className={integrationTab === 'vision' ? 'active' : ''}
              onClick={() => setIntegrationTab('vision')}
            >
              Vision <span className={`integration-check ${isIntegrationConfigured('vision') ? 'configured' : 'missing'}`}>✓</span>
            </button>
            <button
              type="button"
              className={integrationTab === 'tmdb' ? 'active' : ''}
              onClick={() => setIntegrationTab('tmdb')}
            >
              TMDB <span className={`integration-check ${isIntegrationConfigured('tmdb') ? 'configured' : 'missing'}`}>✓</span>
            </button>
          </div>
          <div className="status-row">
            <div className="status-item">{integrationTab.toUpperCase()} {renderStatusBadge(integrationStatus[integrationTab])}</div>
          </div>

          {integrationTab === 'barcode' && (
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); saveIntegrationSection('barcode'); }}>
              <p className="subtitle full">
                Barcode provider portal: <a href={getProviderPortalUrl('barcode')} target="_blank" rel="noreferrer">{getProviderPortalUrl('barcode')}</a>
              </p>
              <label>
                Barcode preset
                <select value={integrationForm.barcodePreset} onChange={(event) => applyBarcodePreset(event.target.value)}>
                  <option value="upcitemdb">UPCItemDB</option>
                  <option value="barcodelookup">BarcodeLookup</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                Barcode provider
                <input value={integrationForm.barcodeProvider} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, barcodeProvider: event.target.value }))} />
              </label>
              <label>
                Barcode API URL
                <input value={integrationForm.barcodeApiUrl} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, barcodeApiUrl: event.target.value }))} />
              </label>
              <label>
                Barcode API key header
                <input value={integrationForm.barcodeApiKeyHeader} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, barcodeApiKeyHeader: event.target.value }))} />
              </label>
              <label>
                Barcode query param
                <input value={integrationForm.barcodeQueryParam} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, barcodeQueryParam: event.target.value }))} />
              </label>
              <label>
                Barcode API key
                <input type="password" value={integrationForm.barcodeApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, barcodeApiKey: event.target.value }))} placeholder={integrationMeta.barcodeApiKeyMasked || 'Enter new key'} />
              </label>
              <label className="full checkbox">
                <input type="checkbox" checked={integrationForm.clearBarcodeApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, clearBarcodeApiKey: event.target.checked }))} />
                Clear saved barcode key
              </label>
              <div className="inline-controls full">
                <input value={barcodeTestUpc} onChange={(event) => setBarcodeTestUpc(event.target.value)} placeholder="Test UPC" />
                <button type="button" className="secondary small" onClick={testBarcodeIntegration} disabled={integrationTestLoading === 'barcode'}>
                  {integrationTestLoading === 'barcode' ? 'Testing...' : 'Test barcode key'}
                </button>
                <button type="submit" className="primary small" disabled={integrationSaving}>
                  {integrationSaving ? 'Saving...' : 'Save barcode settings'}
                </button>
              </div>
            </form>
          )}

          {integrationTab === 'vision' && (
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); saveIntegrationSection('vision'); }}>
              <p className="subtitle full">
                Vision provider portal: <a href={getProviderPortalUrl('vision')} target="_blank" rel="noreferrer">{getProviderPortalUrl('vision')}</a>
              </p>
              <label>
                Vision preset
                <select value={integrationForm.visionPreset} onChange={(event) => applyVisionPreset(event.target.value)}>
                  <option value="ocrspace">OCR.Space</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                Vision provider
                <input value={integrationForm.visionProvider} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, visionProvider: event.target.value }))} />
              </label>
              <label>
                Vision API URL
                <input value={integrationForm.visionApiUrl} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, visionApiUrl: event.target.value }))} />
              </label>
              <label>
                Vision API key header
                <input value={integrationForm.visionApiKeyHeader} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, visionApiKeyHeader: event.target.value }))} />
              </label>
              <label className="full">
                Vision API key
                <input type="password" value={integrationForm.visionApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, visionApiKey: event.target.value }))} placeholder={integrationMeta.visionApiKeyMasked || 'Enter new key'} />
              </label>
              <label className="full checkbox">
                <input type="checkbox" checked={integrationForm.clearVisionApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, clearVisionApiKey: event.target.checked }))} />
                Clear saved vision key
              </label>
              <div className="inline-controls full">
                <input value={visionTestImageUrl} onChange={(event) => setVisionTestImageUrl(event.target.value)} placeholder="Test image URL" />
                <button type="button" className="secondary small" onClick={testVisionIntegration} disabled={integrationTestLoading === 'vision'}>
                  {integrationTestLoading === 'vision' ? 'Testing...' : 'Test vision key'}
                </button>
                <button type="submit" className="primary small" disabled={integrationSaving}>
                  {integrationSaving ? 'Saving...' : 'Save vision settings'}
                </button>
              </div>
            </form>
          )}

          {integrationTab === 'tmdb' && (
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); saveIntegrationSection('tmdb'); }}>
              <p className="subtitle full">
                TMDB portal: <a href={getProviderPortalUrl('tmdb')} target="_blank" rel="noreferrer">{getProviderPortalUrl('tmdb')}</a>
              </p>
              <label>
                TMDB preset
                <select value={integrationForm.tmdbPreset} onChange={(event) => applyTmdbPreset(event.target.value)}>
                  <option value="tmdb">TMDB</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                TMDB provider
                <input value={integrationForm.tmdbProvider} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, tmdbProvider: event.target.value }))} />
              </label>
              <label>
                TMDB API URL
                <input value={integrationForm.tmdbApiUrl} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, tmdbApiUrl: event.target.value }))} />
              </label>
              <label>
                TMDB key header (optional)
                <input value={integrationForm.tmdbApiKeyHeader} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, tmdbApiKeyHeader: event.target.value }))} />
              </label>
              <label>
                TMDB key query param
                <input value={integrationForm.tmdbApiKeyQueryParam} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, tmdbApiKeyQueryParam: event.target.value }))} />
              </label>
              <label>
                TMDB API key
                <input type="password" value={integrationForm.tmdbApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, tmdbApiKey: event.target.value }))} placeholder={integrationMeta.tmdbApiKeyMasked || 'Enter new key'} />
              </label>
              <label className="full checkbox">
                <input type="checkbox" checked={integrationForm.clearTmdbApiKey} onChange={(event) => setIntegrationForm((prev) => ({ ...prev, clearTmdbApiKey: event.target.checked }))} />
                Clear saved TMDB key
              </label>
              <div className="inline-controls full">
                <input value={tmdbTestTitle} onChange={(event) => setTmdbTestTitle(event.target.value)} placeholder="TMDB test title" />
                <input value={tmdbTestYear} onChange={(event) => setTmdbTestYear(event.target.value)} placeholder="TMDB test year" />
                <button type="button" className="secondary small" onClick={testTmdbIntegration} disabled={integrationTestLoading === 'tmdb'}>
                  {integrationTestLoading === 'tmdb' ? 'Testing...' : 'Test TMDB key'}
                </button>
                <button type="submit" className="primary small" disabled={integrationSaving}>
                  {integrationSaving ? 'Saving...' : 'Save TMDB settings'}
                </button>
              </div>
            </form>
          )}

          <div className="inline-controls">
            <button type="button" className="secondary small" onClick={loadIntegrationSettings}>Reload integration settings</button>
          </div>
          {integrationMessage && <p className="message success">{integrationMessage}</p>}
          {integrationTestMessage && <p className="message success">{integrationTestMessage}</p>}
        </section>
      )}

      {activeTab === 'admin-settings' && isAdmin && (
        <section className="card section">
          <h2>Admin Settings</h2>
          <p className="subtitle">Global UI preferences applied to all authenticated sessions.</p>
          <form className="form-grid" onSubmit={saveGeneralSettings}>
            <label>
              Theme
              <select
                value={generalSettings.theme}
                onChange={(event) => setGeneralSettings((prev) => ({ ...prev, theme: event.target.value }))}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              UI density
              <select
                value={generalSettings.density}
                onChange={(event) => setGeneralSettings((prev) => ({ ...prev, density: event.target.value }))}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <div className="inline-controls full">
              <button type="submit" className="primary small" disabled={generalSettingsSaving}>
                {generalSettingsSaving ? 'Saving settings...' : 'Save settings'}
              </button>
            </div>
          </form>
          {generalSettingsMessage && <p className="message success">{generalSettingsMessage}</p>}
        </section>
      )}

      {activeTab === 'admin-users' && isAdmin && (
        <section className="card section">
          <h2>User management</h2>
          {usersError && <p className="message error">{usersError}</p>}
          {usersLoading ? <p>Loading users...</p> : (
            <div className="list">
              {users.map((entry) => (
                <div className="list-row" key={entry.id}>
                  <div>
                    <strong>{entry.name}</strong>
                    <p>{entry.email}</p>
                  </div>
                  <div className="inline-controls">
                    <select
                      value={entry.role}
                      onChange={(event) => updateUserRole(entry.id, event.target.value)}
                    >
                      {USER_ROLES.map((role) => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="danger small"
                      disabled={entry.id === user?.id}
                      onClick={() => removeUser(entry.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h2>Invites</h2>
          <form onSubmit={createInvite} className="invite-form">
            <input
              type="email"
              required
              placeholder="teammate@example.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
            <button type="submit" className="primary small">Create invite</button>
          </form>
          {inviteMessage && <p className="message success">{inviteMessage}</p>}
          {inviteUrlMessage && (
            <div className="invite-url-wrap">
              <p className="subtitle">Generated invite URL</p>
              <code className="invite-url">{inviteUrlMessage}</code>
              <div className="inline-controls">
                <button type="button" className="secondary small" onClick={() => copyInviteValue(inviteUrlMessage)}>
                  Copy invite URL
                </button>
              </div>
            </div>
          )}
          {invitesError && <p className="message error">{invitesError}</p>}
          {invitesLoading ? <p>Loading invites...</p> : (
            <div className="list">
              {invites.map((invite) => (
                <div className="list-row" key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    <p className="invite-url">{`${window.location.origin}/register?invite=${encodeURIComponent(invite.token)}&email=${encodeURIComponent(invite.email)}`}</p>
                    <p>Expires {new Date(invite.expires_at).toLocaleString()}</p>
                    <p>Status: {invite.used ? 'used' : 'active'}</p>
                  </div>
                  <div className="inline-controls">
                    <button type="button" className="secondary small" onClick={() => copyInviteValue(invite.token)}>
                      Copy token
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => copyInviteValue(`${window.location.origin}/register?invite=${encodeURIComponent(invite.token)}&email=${encodeURIComponent(invite.email)}`)}
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      </main>
    </div>
  );
}

export default App;
