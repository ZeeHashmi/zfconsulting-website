(function () {
  const isProduction = window.location.hostname === 'zfconsulting.com.au' ||
    window.location.hostname === 'www.zfconsulting.com.au';

  const environments = {
    development: {
      environment: 'development',
      url: 'http://127.0.0.1:54321',
      publishableKey: '',
    },
    production: {
      environment: 'production',
      url: 'https://qxmwggjwyjlvioddckgq.supabase.co',
      publishableKey: 'sb_publishable_V43Y25Ty4j_izzwpLUlYbw_uDVX_C-j',
    },
  };

  window.ZF_SUPABASE_DEMO = Object.freeze(
    environments[isProduction ? 'production' : 'development'],
  );
}());
