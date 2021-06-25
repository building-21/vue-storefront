import VueAnalytics from 'vue-analytics'
import { Logger } from '@vue-storefront/core/lib/logger'
import { once, isServer } from '@vue-storefront/core/helpers'
import { StorefrontModule } from '@vue-storefront/core/lib/modules';
import Vue from 'vue';
import VueAppInsights from 'vue-application-insights'

const googleAnalyticsStore = {
  namespaced: true,
  state: {
    key: null
  }
}

//
// NOTE: This is NOT Google Analytics. This uses Application Insights!
//
export const GoogleAnalyticsModule: StorefrontModule = function ({ store, router, appConfig }) {
  if (!isServer) {
  }

  if (appConfig.analytics.id && !isServer) {
    once('__VUE_EXTEND_ANALYTICS__', () => {
      // Notice the use of VueAppInsights, not GA.
      Vue.use(VueAppInsights, {
        id: appConfig.analytics.id,
        trackInitialPageView: true,
        router
      })
    })
  } else {
    Logger.warn(
      'Google Analytics extension is not working. Ensure Google Analytics account ID is defined in config',
      'GA'
    )()
  }

  store.registerModule('google-analytics', googleAnalyticsStore)

  //
  // We can use the following to send custom events on interesting actions.
  //
  if (appConfig.analytics.id && !isServer) {
    // Vue.prototype.$bus.$on('order-after-placed', event => {
    //    this.$appInsights.trackEvent("custom_action", { value: 'ok' });
    // })
  }
}
