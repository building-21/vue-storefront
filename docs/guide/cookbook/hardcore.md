# (Hard)Core Training

## Introduction

Vue Storefront is getting more and more popular with more than 20 sites running on production. By the same time, the VSF Framework evolves with each new release and the docs are hardly trying to follow! 

These training materials are a set of Chief-recipes, experiences learned from the trenches. I’m trying to answer how to run Vue Storefront on production, troubleshoot most of the common problems and explain all the hidden features of Vue Storefront that can help you scale the application and solve most common issues.

Some of the topics here were found as a [frequently asked questions from our Forum](https://forum.vuestorefront.io/c/help). Some [came from Slack](http://slack.vuestorefront.io). Some came from core-consulting and our own works. What's common: all are super-crucial for stable Vue Storefront run on production and all are resulting some (hard)core results when done wrong. 

### Table of content

1. <a href="#tip1">Tip 1: Memory leaks</a>
2. <a href="#tip2">Tip 2: SSR Cache</a>
3. <a href="#tip3">Tip 3: Avoiding prices desynchronization (`alwaysSyncPlatformPricesOver`)</a>
4. <a href="#tip4">Tip 4: Avoiding stock desynchronization (`filterOutUnavailableVariants`)</a>
5. <a href="#tip5">Tip 5: How Vue Storefront calculates prices and taxes</a>
6. <a href="#tip6">Tip 6: Limiting SSR HTML size (a.k.a INITIAL_STATE optimization)</a>
7. <a href="#tip7">Tip 7: Url Dispatcher explained + troubledshooting</a>
8. <a href="#tip8">Tip 8: Multistore configuration explained</a>
9. <a href="#tip9">Tip 9: HTML minimization, compression, headers</a>
10. <a href="tip10">Tip 10: Production catalog indexing + cache invalidation</a>
11. <a href="tip11">Tip 11: Using Magento Checkout</a>
12. <a href="tip12">Tip 12: ElasticSearch production setup</a>
13. <a href="tip13">Tip 13: .htaccess, server side redirects, HTTP codes and headers, middlewares</a>
14. Tip 14: Which fields of product, category and attribute are really being used by VSF
15. Tip 15: Tracing, monitoring, logging the application and Troubleshooting
 - Cloud trace
 - New Relic
 - PM2
 - Output logs explained
16. Tip 16: Unexpected features (explained by config file properties):
 - `dynamicConfigReload` - for easier deployments
 - `useExactUrlsNoProxy` - for not using our default image resizer
 - `sourcePriceIncludesTax` vs `finalPriceIncludesTax` - and how the prices work.


## <a id="tip1">Tip 1: Memory leaks</a>
Vue Storefront consist of two NodeJS applications:
- `vue-storefront` - which is the frontend app, with the entry point of [`core/scripts/server.js`](https://github.com/DivanteLtd/vue-storefront/blob/4ed26d7f1978a9e798edcddf1cf2f970c3e64e4f/core/scripts/server.js#L269)
- `vue-storefornt-api` - which is backend/api app.

If you're familiar with PHP apps and running PHP on production (for example using fastCGI or FPM) - NodeJS works totally different way. It's not executing `node` process per each request but rather running an internal http server which serves all the subsequent requests. It's single threaded, long running task. Because of that specific it's fairly easy to get into memory leaks problems; especially with the `vue-storefront` app which is far more complex than the API.

How did you know you encounter the memory leaks? The `pm2` [memory ussage](http://pm2.keymetrics.io/docs/usage/monitoring/) (`yarn pm2 status` or `yarn pm2 monit` for details) is growing with each page refresh.

Vue.js docs has pretty good section on [how to avoid Vue.js memory leaks](https://vuejs.org/v2/cookbook/avoiding-memory-leaks.html). 

One of the key points there is that you should avoid `Vue.use` and make sure it's called always just `once`. In the Vue Storefront code you can pretty often find a snippet like this:

```js
import { once } from '@vue-storefront/core/helpers'
once('__VUE_EXTEND_RR__', () => {
  Vue.use(VueRouter)
})
```
Feel free to use it around all your plugins and mixins instantiation. 

Another thing is to properly handle the events. Each `EventBus.$on` must have it's `EventBus.$off`. Please avoid the situation where **you bind the event in `created`  whenever possible**. The `created` is called in the SSR mode; if you bind in `beforeMount` it will be executed only in the CSR (client's browser) which is 99% desired behavior and you not risk the memory leaks on events.

### Quick wins

- PM2 is restarting the process after [1GB of RAM (by default)](https://github.com/DivanteLtd/vue-storefront/blob/4ed26d7f1978a9e798edcddf1cf2f970c3e64e4f/docs/guide/cookbook/hardcore.md#L49) - this can be adjusted and together with multiple node `instances` set in `ecosystem.json` it's pretty good work-around for memory leaks,
- We do have an **SSR Output Cache** in which rendered pages are stored in the Redis memory cache so no Vue SSR Renderer is being used; you just need to remember about the cache invalidation (there is a Tip for that in this doc). Output cache usually solves the memory leak issue the hard way - without eliminating the root cause. [Read more how to set it up](https://docs.vuestorefront.io/guide/basics/ssr-cache.html)
- Make sure you're having `runInNewContext` set to `true` (default value!) in [`core/scripts/server.js`](https://github.com/DivanteLtd/vue-storefront/blob/4ed26d7f1978a9e798edcddf1cf2f970c3e64e4f/docs/guide/cookbook/hardcore.md#L64); without it the [Stateful Singletons](https://github.com/DivanteLtd/vue-storefront/issues/2664) like `RouteManager` or `i18n` we're using will cause the memory leaks at huuge scale,
- We do have an **Static Pages Generator** - currently experimental feature - can generate the whole site into set of static HTML files so they could be served even directly from cloud provider/CDN - no memory leaks possible; waht you need to take care of in this mode is cache invalidation (not currently supported but easy to add). [Read more on static page generator](https://github.com/DivanteLtd/vue-storefront/pull/3256),
- In case of any concerns [find out how we dealt with memory leaks](https://github.com/DivanteLtd/vue-storefront/pulls?utf8=%E2%9C%93&q=is%3Apr+memory+is%3Aclosed+leak) in Vue Storefront core - and check if any of those edge cases can be a case for your project.

### Tracing memory leaks

There are many ways to trace the memory leaks, however we're using the browser tools (Memory profile) most of the times. [Here you have it explained in details](https://marmelab.com/blog/2018/04/03/how-to-track-and-fix-memory-leak-with-nodejs.html). Another usefull tools are [New Relic APM](http://newrelic.com) and [Google Trace](https://cloud.google.com/trace/docs/setup/nodejs)

## <a id="tip2">Tip2: SSR Output cache</a>

Vue Storefront supports [Server Side Rendering](https://vuejs.org/v2/guide/ssr.html). In this mode the same code which is being executed be the browser in browser (CSR; Client Side Rendering) runs on the srver in order to generate the HTML markup. The markup is being transfered to the browser, rendered (extremly fast as the browsers were all optimized to ... render html text by the last 20+ years) and [hydrated](https://ssr.vuejs.org/guide/hydration.html) from the [initial state](https://ssr.vuejs.org/guide/data.html#final-state-injection). By this whole procedure the client side / browser scripts can use exactly the same code base (Universal). Another cool feature is that static HTML markup is well indexed by Search Engine crawlers which is extremly important for SEO.

Usually, Vue Storefront works pretty fast and all SSR requests are being finished in between 100-300ms; however, if your database is huuuge or your server resources are low, or probably the traffic is extremly high you might want to enable the output cache. The other reason is that you might want to use SSR cache to prevent memory leaks - well, rather hide them :-)

The SSR cache is [pretty well documented in our docs](https://docs.vuestorefront.io/guide/basics/ssr-cache.html). What's important it works for both: `vue-storefront` and `vue-storefront-api`.
[Read on all the caching mechanisms](https://medium.com/the-vue-storefront-journal/caching-on-production-10b00a5614f8) that Vue Storefront is using.

In the SSR Output cache mode enabled, the [`core/server.js`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/scripts/server.js#L187) stores the rendered output pages along with http headers into Redis cache. If the page exists in Redis - is being served without even starting the Vue SSR Renderer.

We're using Redis in order to use the [`redis-tagging`](https://www.npmjs.com/package/redis-tagging) library. Naming and caching are two most ddifficult areas of software development. Cache tagging helps us to deal with cache invalidation.

We're tagging the output pages with [product](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/modules/catalog/helpers/search.ts#L69) and [category](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/modules/catalog/store/category/actions.ts#L121) tags. Then all the indexers including: `magento1-vsbridge-indexer`, `mage2vuestorefront`, `magento2-vsbridge-indexer` will invalidate the cache, by specific product or category ID. It means, the [`invalidate`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/scripts/server.js#L156) method will clear out the cache pages tagged with this specific product id. Note: this URL requires you to pass the invalidation token set in the [config](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/config/default.json#L12).

You can add any number of the specific cache tags - by just extending the [`availableCacheTags`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/config/default.json#L11) and [pushing the tags to `ssrContext`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/pages/Home.js#L19) so they can be used by `core/scripts/server`.

This `context` argument passed to `asyncData()` is actually the same context object used by [`core/scripts/server.js`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/scripts/server.js#L168), so we're using it as transfer object for passing the tags back and forth between server and Vue.js application.

**Note:** If you have the SSR cache enabled (in the `vue-storefront-api` or `vue-storefront` app) please make sure, you're not using the cache on different layer (for example Varnish or nginx). Otherwise the cache invalidation mechanism won't work. 

The dynamic tags config option: `useOutputCacheTagging` - if set to `true`, Vue Storefront is generating the special HTTP Header `X-VS-Cache-Tags`

```js
res.setHeader('X-VS-Cache-Tags', cacheTags);
```

Cache tags are assigned regarding the products and categories that are used on the specific page. A typical `X-VS-Cache-Tags` tag looks like this:

```
X-VS-Cache-Tags: P1852 P198 C20
```

The tags can be used to invalidate the Varnish cache, if you're using it. [Read more on that](https://www.drupal.org/docs/8/api/cache-api/cache-tags-varnish).

**Note:**  All the official Vue Storefront data indexers including [magento1-vsbridge-indexer](https://github.com/DivanteLtd/magento1-vsbridge-indexer), [magento2-vsbridge-indexer](https://github.com/DivanteLtd/magento2-vsbridge-indexer) and [mage2vuestorefront](https://github.com/DivanteLtd/mage2vuestorefront) support the cache invalidation. If the cache is enabled in both API and Vue Storefront frontend app, please make sure you are properly using the `config.server.invalidateCacheForwardUrl` config variable as the indexers can send the cache invalidate request only to one URL (frontend or backend) and it **should be forwarded**. Please check the default forwarding URLs in the `default.json` and adjust the `key` parameter to the value of `server.invalidateCacheKey`.


## <a id="tip3">Tip 3: Avoiding prices desynchronization (`alwaysSyncPlatformPricesOver`)</a>

Vue Storefront indexers (`magento2-vsbridge-indexer`, `magento1-vsbridge-indexer`, `mage2vuestorefront`) all stores the product prices (before/after catalog rules applied) into the ElasticSearch. Butt ElasticSearch can be easily de-synced or the synchronization can be lagged. To avoid the risk of displaying non current prices to the customers Vue Storefront has at least 3 mechanisms - with the `alwaysSyncPlatformPricesOver` on the top.

**Note:** If you're using the `mage2vuestorefront` for syncing the products please make sure you're syncing the prices **after catalog rules** applied. For this purpose we've a special flags to be set on:

```bash
export PRODUCTS_SPECIAL_PRICES=true
export PRODUCTS_RENDER_PRICES=true
node --harmony cli.js products --removeNonExistent=true --partitions=1
```

When the `config.products.alwaysSyncPlatformPricesOver` option is on, Vue Storefront will update the prices visible on all the listings and product detail pages **directly from Magento**. The code in charge for this operation is located in the [`doPlatformPricesSync`](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/catalog/helpers/index.ts#L212) helper which is being called from the [`tax/calculateTaxes`](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/catalog/store/tax/actions.ts#L74) action.

**Note:** This mode works whenever the prices are caluclated server either client's side (`config.tax.calculateServerSide` option).

Check if the [way Vue Storefront syncs the prices](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/catalog/helpers/index.ts#L216) is exactly what you need, and if not [override this action](https://docs.vuestorefront.io/guide/cookbook/module.html#_2-2-recipe-b-override-vuex-store-with-extendstore).

The `alwaysSyncPlatformPricesOver` mode has two additional options:

1. Clear the prices before sync: `config.products.clearPricesBeforePlatformSync` - when `true`, user won't see the prices cached in Elastic before getting the new prices from Magento
2. Synchronous mode - `config.products.waitForPlatformSync` -  by default the price sync is running in parallel to disyplaing the product or category content. We can make it synchronous (waiting for this process to finish) in order we'd like to have just the current prices from Magento rendered in the HTML markup (SSR; otherwise the prices in SSR will be from Elastic).

More than that - Vue Storefront always get's the **platform totals** (the final prices visible in the shopping cart and the order summary) from Magento/any other backend. There is then no risk we'll see the product at the wrongly set price.

## <a id="tip4">Tip 4: Avoiding stock desynchronization (`filterOutUnavailableVariants`)</a>

Pretty much the same case like with the Prices (Tip 3) can occur with the product stocks. By default, all the indexers are setting the [stock information right into the product object](https://github.com/DivanteLtd/vue-storefront-integration-sdk/blob/tutorial/Format-product.md):

 - it's in the main structure of `product.stock`
 - it's set for the `configurable_children` into `product.configurable_children.stock`.

 This information can be outdated.

 Vue Storefront **by default** checks the current stock information when:
 - [**user is adding product to the cart**](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/cart/store/actions/itemActions.ts#L53) - this is an async sync (similar one is run when browsing the product variants - you can get info like `0 items available` when switching colors and sizes); `Checkout.js` is waiting for all the results from the [`stock/queueCheck`](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/pages/Checkout.js#L69) calls,
 - when the **cart is synced** with the server - eCommerce backend [checks the product availability once again](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/cart/store/actions/mergeActions.ts#L45) and [notify user](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/cart/components/AddToCart.ts#L31) if the product can't be added to the cart or restores previous quantity (if changed),
 - when the `filterOutUnavailableVariants` mode is on and the user a) enters the product page, b) browses the category pages.

 The `config.products.filterOutUnavailableVariants` mode is pretty interesting thing because only by having this mode switched on you can be sure we're **not displaying unavailable variants**. When it's true Vue Storefront is taking the Stock information out of Magento and updates the `product.stock` info for the whole product list + product page (current product). Then it removes all the `configurable_children` that are not avaialable. [See the detailed implementation](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/catalog/helpers/index.ts#L121).

There are two additional settings for this mode on:
 - `config.prodducts.configurableChildrenStockPrefetchStatic` - when this is true, Vue Storefront is prefetching the stock info for the statically set number of product, it can be configured by `config.products.configurableChildrenStockPrefetchStaticPrefetchCount`,
 - `config.prodducts.configurableChildrenStockPrefetchDynamic` - when this is set to true, Vue Storefront is prefetching the stock info for any visible product; it's done in the [`ProductTile.vue](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/src/themes/default/components/core/ProductTile.vue#L108) - make sure your theme is supporting this.
    
We've got the limited support for Magento MSI in the default implementation. [Make sure you've got it enabled when on Magento 2.3.x](https://github.com/DivanteLtd/vue-storefront-api/pull/226).

**Note:** This feature might then be used for the **Donut caching** strategies (related to Tip 2 - SSR cache).

**Note:** If you need to avoid Magento stock calls there is a way by getting the data with the same format as `https://vue-storefront-api/api/stock/list` is returning but from Elastic. It should be a drop-in replacement - I [mean changing the `stock.endpoint`](https://github.com/DivanteLtd/vue-storefront/blob/bb9044d6aaa36d4881733876f4646fabe7b6e102/config/default.json#L368) to this new one. Et viola: you avoid asking Magento, still having this 'cache punch holing' with `config.products.filterOutUnavailableVariants` mode on

There is a ready made endpoint for getting stock from Elastic (not from Magento) [is here #PR330](https://github.com/DivanteLtd/vue-storefront-api/pull/330).

**Troubleshooting:** If the non-existing variants won't disappear that means some frontend work on your side needs to be done. I mean - with this `filterOutUnavailableVariants` setting, we're pulling the current stock info to `product.stock` and `product.configurable_children.stock` properties. By those properties updated we're then removing the out-of-stock `configurable_children`.
If the variants arer still available then [take a look at this line](https://github.com/DivanteLtd/vue-storefront/blob/48233bfa4575be218a51cccd2474ec358671fc01/core/modules/catalog/store/product/actions.ts#L629) and there should be a change made like:

from:

```js
        if (isServer) {
          subloaders.push(context.dispatch('setupBreadcrumbs', { product: product }))
          subloaders.push(context.dispatch('filterUnavailableVariants', { product: product }))
        } else {
          attributesPromise.then(() => context.dispatch('setupBreadcrumbs', { product: product })) // if this is client's side request postpone breadcrumbs setup till attributes are loaded to avoid too-early breadcrumb switch #2469
          context.dispatch('filterUnavailableVariants', { product: product }) // exec async
        }
```
to:

```js
          subloaders.push(context.dispatch('filterUnavailableVariants', { product: product }))
        if (isServer) {
          subloaders.push(context.dispatch('setupBreadcrumbs', { product: product }))
        } else {
          attributesPromise.then(() => context.dispatch('setupBreadcrumbs', { product: product })) // if this is client's side request postpone breadcrumbs setup till attributes are loaded to avoid too-early breadcrumb switch #2469
        }
```

Just in order to make sure that attribute filtering always takes place before rendering the PDP.

## <a id="tip5">Tip 5: How Vue Storefront calculates prices and taxes</a>

Vue Storefront has two modes of calculating the product prices:
- Client side (when `config.tax.calculateServerSide` is set to `false`) - that can be usefull in case the tax should be recalculated based on the address change,
- Server side (when `config.tax.calculateServerSide` is set to `true`) - which is our default mode.

Depending on the mode, taxes are calulated by [`taxCalc.ts` client side](https://github.com/DivanteLtd/vue-storefront/blob/5f2b5cd6a8496a60884c091e8509d3b58b7a0358/core/modules/catalog/helpers/taxCalc.ts#L74) or [`taxcalc.js` server side](https://github.com/DivanteLtd/vue-storefront-api/blob/d3d0e7892cd063bbd69e545f3f2b6fdd9843d524/src/lib/taxcalc.js#L251-L253). 

You may see that both these files are applying **exactly** the same logic.

In order to calculate the prices and taxes we need first toget the proper tax rate. It's based on [`taxrate`](https://github.com/DivanteLtd/vue-storefront-integration-sdk#taxrate-entity) entity, stored in the Elastic. Each product can have the property [`product.tax_class_id`](https://github.com/DivanteLtd/vue-storefront/blob/5f2b5cd6a8496a60884c091e8509d3b58b7a0358/core/modules/catalog/helpers/taxCalc.ts#L213) set. Depending on it's value Vue Storefront is applying the `taxrate`, it's also applying the [country and region to the filter](https://github.com/DivanteLtd/vue-storefront/blob/5f2b5cd6a8496a60884c091e8509d3b58b7a0358/core/modules/catalog/helpers/taxCalc.ts#L226). 

**Note:** We're currently not supporting searching the tax rules by `customer_tax_class_id` neither by the `tax_postcode` fields of `taxrate` entity. Pull requests more than welcome ;)

After getting the right tax rate we can calculate the prices.

We've got the following price fields priority in the VS:
- `final_price` - if set, depending on the `config.tax.finalPriceIncludesTax` - it's taken as final price or Net final price,
- `special_price` - if it's set and it's lower than `price` it will replace the `price` and the `price` value will be set into `original_price` property,
- `price` - if set, dedending on the `config.tax.sourcePriceIncludesTax` - it's taken as final price or Net final price.

Depending on the `config.tax.finalPriceIncludesTax` and `config.tax.sourcePriceIncludesTax` settings Vue Storefront calculates the prices and stores them into following fields.

Product Special price:
- `special_price` - optional, if set - it's always Net price,
- `special_price_incl_tax` - optional, if set - it's always price after taxes,
- `special_price_tax` - optional, if set it's the tax amount.

Product Regular price:
- `price` - required, if set - it's always Net price,
- `price_incl_tax` - required, if set - it's always price after taxes,
- `price_tax` - required, if set it's the tax amount,

Product Final price:
- `final_price` - optional, if set - it's always Net price,
- `final_price_incl_tax` - optional, if set - it's always price after taxes,
- `final_price_tax` - optional, if set it's the tax amount,

Product Original price (set only if `final_price` or `special_price` are lower than `price`):
- `original_price` - optional, if set - it's always Net price,
- `original_price_incl_tax` - optional, if set - it's always price after taxes,
- `original_price_tax` - optional, if set it's the tax amount.

**Note:** The prices are being set for all `configurable_children` with the exact same format
**Note:** If any of the `configurable_children` has the price lower than the main product, the main product price will be updated accordingly.

## <a id="tip6">Tip 6: Limiting SSR HTML size (a.k.a INITIAL_STATE optimization)</a>

One of the key side-effects of the [Server Side Rendering](https://vuejs.org/v2/guide/ssr.html) is the need to provide the initial Vuex state right to the browser just before the page will be hydrated. 

Hydration means - Vue.js is matching the statically generated HTML markup with virtually generated (CSR) Vue.js component tree. **Only after this process site becomes interactive**. Even slightly different markup might cause SSR hydration errors. Therefore, Vue.js is requiring us to [output the `window.__INITIAL_STATE__`](https://github.com/DivanteLtd/vue-storefront/blob/8f3ce717a823ef3a5c7469082b8a8bcb36abb5c1/core/client-entry.ts#L29) which is then used to **replace** the Vuex initial state. Then, the [app is being hydrated](https://github.com/DivanteLtd/vue-storefront/blob/develop/core/client-entry.ts#L111) by `app.mount()` call.

The only problem is, that the `__INITIAL_STATE__` can be really huuuuuuuge. On category pages, including a lot of product listings it can be in megabytes!
Vue Storefront provides you with few mechanisms to control the initial state.

1. Vue Storefront provides you a mechanism to control the `__INITIAL_STATE__` [based on the `config.ssr.initialStateFilter`](https://github.com/DivanteLtd/vue-storefront/blob/8f3ce717a823ef3a5c7469082b8a8bcb36abb5c1/core/scripts/utils/ssr-renderer.js#L40) fields list. So you can remove the fields from `__INITIAL_STATE__` - even using the `.` notation. So you can put `attribute` on the list to remove the whole state for `attribute` Vuex module OR you can specify `attribte.list_by_code` to remove just that. By using this mechanism, you can process much more data in the SSR than are send to the browser (see point no. 2 which is just about opposite approach to limit the set of processed information).

2. You might also want to use the [`config.entities.*.includeFields`](https://github.com/DivanteLtd/vue-storefront/blob/8f3ce717a823ef3a5c7469082b8a8bcb36abb5c1/config/default.json#L170) filter. These lists of fields are set to limit the number of fields [loaded from Elastic](https://github.com/DivanteLtd/vue-storefront/blob/8f3ce717a823ef3a5c7469082b8a8bcb36abb5c1/core/lib/search.ts#L31). If you add any new field to your entity though, please make sure you also included it in the `includeFields` list.

By using any of those mechanisms you must be fully aware of the **hydration damage** they might cause. In order to prevent any hydration issues, you might use [`lazy-hydrate`](https://github.com/maoberlehner/vue-lazy-hydration) that will let you control the hydration flow for specific parts (components) on the page. Especially the [manual hydration](https://github.com/maoberlehner/vue-lazy-hydration#manually-trigger-hydration) can be usefull.

The general rule of thumb is that **when you remove anything from the intial state** then you shoud:
- load this data ASAP in the client side (eg. in `beforeMount`),
- hydrate the component **only after** the data was loaded.

See how we did it for [`Category.vue`](https://github.com/DivanteLtd/vue-storefront/blob/ab27bfbd8abef5f1d37666a38fa0387f50ba6eca/src/themes/default/pages/Category.vue#L70) - where the hydration is being manually triggered by the [`loading`](https://github.com/DivanteLtd/vue-storefront/blob/ab27bfbd8abef5f1d37666a38fa0387f50ba6eca/src/themes/default/pages/Category.vue#L70) flag.

**Note:** Please make sure if you're loading your category tree dynamically - as the category trees can be truly heavy with all these subcategories included. By default Vue Storefront offers this [dynamic category prefetching from v1.7](https://docs.vuestorefront.io/guide/basics/configuration.html#dynamic-categories-prefetching).

You can save up to 30-40% of the page size which positively improve the Lighthouse/Pagespeed scores. However not always improves the User Experience - as the lazy hydration typically requires you to fetch the required data by another network call (which can be skipped by the initial state mechanism).

Of course, in the end please make sure that you compress (gzip + minify) the SSR output - probably on [nginx level](https://www.digitalocean.com/community/tutorials/how-to-increase-pagespeed-score-by-changing-your-nginx-configuration-on-ubuntu-16-04) or using the [compression](https://www.npmjs.com/package/compression) and/or [minify](https://www.npmjs.com/package/express-minify) middleware added to the [`core/scripts/server.js`](https://github.com/DivanteLtd/vue-storefront/blob/8f3ce717a823ef3a5c7469082b8a8bcb36abb5c1/core/scripts/server.js#L116)

## <a id="tip7">Tip 7: Url Dispatcher explained + troubledshooting</a>

Starting with Vue Storefront 1.9 we're supporting [custom url structure](https://docs.vuestorefront.io/guide/basics/url.html). `UrlDispatcher` is enabled by the [`config.seo.useUrlDispatcher`](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/config/default.json#L29). 

The business logick of the dispatcher was implemented as a [Vue router guard](https://router.vuejs.org/guide/advanced/navigation-guards.html) - [`beforeEach`](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/router/beforeEach.ts#L41).

The dispatcher is first runing the [`url/mapUrl`](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/store/actions.ts#L42). This action is first checking the `state.dispatcherMap` for the previously registered URL mapping. If no mapping is set then dispatcher is checking the [`localStorage` cache](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/store/actions.ts#L51) and only after that the `mappingFallback` action is being called.

It's the place where the true mapping is taking place. By default, Vue Storefront first checks the URL against Elastic, `product` entities - using the `url_path` as a filter. If it's not found (statistically products are 10xmore frequently browsed by URL than categories because of their count), then the request to `category` collection is being made.

Once the route was mapped it's [registered](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/store/actions.ts#L56) in the `dispatcherMap` in order to not execute the additional network request in the future.

The optimization hack is that [`category-next/loadCategoryProducts`](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/catalog-next/store/category/actions.ts#L100) already registers the mapping - so clicking the product from the category list doesn't require any network call to get the proper route data.

As you might seen the `url/mapUrl` returns the data in a very similar format to routes collection used by vue-router. **It's not the real route though**. It's being converted to `Route` object by the `processDynamicRoute` helper before being processed by the router itself. To avoid any user redirections we're using the `RouterManager` to [add this route to the `vue-router` routing table](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/router/beforeEach.ts#L43) and forward the user to this new, exact match route in order to render the proper page.

This mechanism is pretty flexible as you may add the dynamic routes on the fly. There is even a [community module](https://github.com/kodbruket/vsf-mapping-fallback) letting you map the url routes programmatically.

**Note:** The [`processDynamicRoute`](https://github.com/DivanteLtd/vue-storefront/blob/3e4191e5e4b1bfc5b349f5d7cff919c695168125/core/modules/url/helpers/index.ts#L26) does convert the `routeData` from `url/mapUrl` to **real** vue `Route` object. It works like it's searching thru all the routes registered by `theme` and `modules`. Example:

If your route data is (`routeData`):

```js
{
  name: 'configurable-product',
  params: {
    slug: product.slug,
    parentSku: product.sku,
    childSku: params['childSku'] ? params['childSku'] : product.sku
}
```

and your `theme/router/index.js` consists the following definition: (`userRoute`)

```js
  { name: 'configurable-product', path: '/p/:parentSku/:slug/:childSku', component: Product }
```

then `processDynamicRoute` helper will return the `Route` object created by merging the `userRoute` with `routeData`

```js
  Object.assign({}, userRoute, routeData, { path: '/' + fullRootPath, name: `urldispatcher-${fullRootPath}` })
```

`fullRootPath` is the url processed by the dispatcher. This new, virtual route is being added to the vue-router routing table and the user is being forwarded to it. So you may see that `url` module can be switched on/off easily as it's using the on-top mechanism over the existing vue-router - mapping the virtual urls to existing theme or module routes.

**Note:** In order to have it up and running please make sure your `products` and `categories` do have the `url_path` properly set and unique.

## <a id="tip8">Tip 8: Multistore configuration explained</a>

You can read about the [basic Multistore configuration in the official docs](https://docs.vuestorefront.io/guide/integrations/multistore.html#changing-the-ui-for-specific-store-views). Vue Storefront supports multistore based on the `StoreView` level. 

`StoreView` is a configuration context object, set by the Vue Storefront per each request - accesible via [`currentStoreView()](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/lib/multistore.ts#L33) helper from [`multistore.ts`](https://github.com/DivanteLtd/vue-storefront/blob/develop/core/lib/multistore.ts).

One `StoreView` is generally speaking a combination of Language + Currency.

Example: If you have a store per country, that supports two languages (eg. Switzerland supporting EURO currency and both French + German languages) you'll probably end up with pair of two `StoreViews`: (EUR; DE) + (EUR; FR). Each `StoreView` has it's own unique name that is being used to differentiate and switch the sites.

Vue Storefront `StoreViews` allows you to differentiate all the basic settings per specific site. [See the config](https://github.com/DivanteLtd/vue-storefront/blob/af640f3aa0372308db534786fea587b24e8e87d3/config/default.json#L91):

```json
 "storeViews": {
      "multistore": false,
      "commonCache": true,
      "mapStoreUrlsFor": ["de", "it"],
      "de": {
        "storeCode": "de",
        "disabled": true,
        "storeId": 3,
        "name": "German Store",
        "url": "/de",
        "appendStoreCode": true,
        "elasticsearch": {
          "host": "/api/catalog",
          "index": "vue_storefront_catalog_de"
        },
        "tax": {
          "sourcePriceIncludesTax": false,
          "defaultCountry": "DE",
          "defaultRegion": "",
          "calculateServerSide": true
        },
        "i18n": {
          "fullCountryName": "Germany",
          "fullLanguageName": "German",
          "defaultLanguage": "DE",
          "defaultCountry": "DE",
          "defaultLocale": "de-DE",
          "currencyCode": "EUR",
          "currencySign": "EUR",
          "dateFormat": "HH:mm D-M-YYYY"
        }
      },
      "it": {
        "storeCode": "it",
        "disabled": true,
        "storeId": 4,
        "name": "Italian Store",
        "url": "/it",
        "appendStoreCode": true,
        "elasticsearch": {
          "host": "/api/catalog",
          "index": "vue_storefront_catalog_it"
        },
        "tax": {
          "sourcePriceIncludesTax": false,
          "defaultCountry": "IT",
          "defaultRegion": "",
          "calculateServerSide": true
        },
        "i18n": {
          "fullCountryName": "Italy",
          "fullLanguageName": "Italian",
          "defaultCountry": "IT",
          "defaultLanguage": "IT",
          "defaultLocale": "it-IT",
          "currencyCode": "EUR",
          "currencySign": "EUR",
          "dateFormat": "HH:mm D-M-YYYY"
        }
      }
    }
  ```

### Create the individual indexes per each specific `StoreView`

First of all - we're having separate Elastic search configs per each storeView. This means you can have `product`, `categories` and `attributes` text attributes translated and storead - each in the separate Elastic search indexes.

Our [default indexer](https://github.com/DivanteLtd/mage2vuestorefront#multistore-setup) and the [magento2-vsbridge-indexer](https://github.com/DivanteLtd/magento2-vsbridge-indexer) both support the multistore indexing.

### Setup the `storeViews` section in the `config/local.json` 

Each storeView must has the unique `code` (`it` and `de` in the example above) set + elasticsearch section pointing to the right index.

**Note:** Remember to populate the same configuration [within the `vue-storefront-api` config file](https://github.com/DivanteLtd/vue-storefront-api/blob/b4198929ef435e20162a192ea2a02cb25e552d45/config/default.json#L50). Please make sure that the `config.availableStores` collection contains all the `storeCodes` you'll be passing to the API as well.

**Note:** The multistore business logick is being applied only when the `config.storeViews.multistore` is set to `true` (the default value is: `false`).

 The `storeCode` parameter [will be appended as a query parameter (`?storeCode`)](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/lib/multistore.ts#L105) to all `vue-storefront-api` requests that will let API know which backend API endpoints to query. By default - with Magento2 [we're adding the proper `storeCode` to the API request calls](https://github.com/DivanteLtd/vue-storefront-api/blob/b4198929ef435e20162a192ea2a02cb25e552d45/src/platform/magento2/util.js#L7). However you can even [differentiate the base url or Magento2 API credentials if you like](https://github.com/DivanteLtd/vue-storefront-api/blob/b4198929ef435e20162a192ea2a02cb25e552d45/src/platform/magento2/util.js#L20). 

 ### Vue Storefront `storeCode` resolver

 Vue Storefront is setting `currentStoreView` value as one of the first things processing the request. It's being done in the [`app.ts:createStore`](https://github.com/DivanteLtd/vue-storefront/blob/af640f3aa0372308db534786fea587b24e8e87d3/core/app.ts#L73) function. The `storeCode` is retrived from the [server context](https://github.com/DivanteLtd/vue-storefront/blob/af640f3aa0372308db534786fea587b24e8e87d3/core/server-entry.ts#L63) or [from the current route](https://github.com/DivanteLtd/vue-storefront/blob/af640f3aa0372308db534786fea587b24e8e87d3/core/server-entry.ts#L67).

 The [`storeCodeFromRoute`](https://github.com/DivanteLtd/vue-storefront/blob/develop/core/lib/storeCodeFromRoute.ts) helper is supporting two ways of obtaining the current store code:

 1) from the url path: https://test.storefrontcloud.io/de vs. https://test.storefrontcloud.io/it
 2) from the [url domain name and path](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/lib/storeCodeFromRoute.ts#L30); this way lets you run Vue Storefront multistore on multiple domains.

 **Note:** You can pass the `storeCode` via server context as well. Server context is set by the [`core/scripts/server.ts`](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/scripts/utils/ssr-renderer.js#L110) - and it's sourced from `ENV.STORE_CODE` or if you're using a HTTP Proxy (like nginx) - from the request header of `x-vs-store-code`. This way you can differentiate store view instances by many different ways and not only by the domain/url.

 ### Routing

 Vue Storefront is adding all the routes to the routing table using [current `storeView` code prefix](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/src/themes/default/index.js#L31). If your [theme/router/index.js](https://github.com/DivanteLtd/vue-storefront/blob/develop/src/themes/default/router/index.js) has the following routes defined, and the `currentStoreVioew().storeCode === 'de'`

 ```js
 let routes = [
  { name: 'checkout', path: '/checkout', component: Checkout },
  { name: 'legal', path: '/legal', component: Static, props: {page: 'lorem', title: 'Legal Notice'}, meta: {title: 'Legal Notice', description: 'Legal Notice - example of description usage'} },
  { name: 'privacy', path: '/privacy', component: Static, props: {page: 'lorem', title: 'Privacy'} },
 ```

Then the [`setupMultistoreRoutes`](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/lib/multistore.ts#L172) helper will add these routes to `vue-router` as:

```js
 let routes = [
  { name: 'checkout', path: '/de/checkout', component: Checkout },
  { name: 'legal', path: '/de/legal', component: Static, props: {page: 'lorem', title: 'Legal Notice'}, meta: {title: 'Legal Notice', description: 'Legal Notice - example of description usage'} },
  { name: 'privacy', path: '/de/privacy', component: Static, props: {page: 'lorem', title: 'Privacy'} },
```

The business logic of modifying the route configs is embeded in the [`localizedRouteConfig`](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/lib/multistore.ts#L189) helper.

**Note:** When you're using the `storeCode` resolver, based on `domain + path` schema then you should set the `config.storeViews.*.appendStoreCode` to `false`. This option prevents `localizedRouteConfig` helper from adding the `storeCode` as a path so the store views can be differentiated based on the `currentStoreView().url` instead - which supports `domain + path`.

**Note:** Please make sure you're creating the links within your theme using the same `localizedRoute` helper. This helper supports string URLs:

```html
<router-link :to="localizedRoute(page.link)" class="cl-accent relative">{{
  page.title
}}</router-link>
```

or route objects:

```html
<router-link
  :to="
    localizedRoute({
      name: product.type_id + '-product',
      params: {
        parentSku: product.parentSku ? product.parentSku : product.sku,
        slug: product.slug,
        childSku: product.sku,
      },
    })
  "
></router-link>
```

**Note:** The `UrlDispatcher` feature - available from Vue Storefront 1.9 supports the multistore routes as well. The `url_path` field passed to [`url/mapUrl`](https://github.com/DivanteLtd/vue-storefront/blob/9dca392a832ba45e9b1c3589eb84f51fbc2e8d6e/core/modules/url/store/actions.ts#L46) action takes the full url - including `storeCode` as an entry parameter. You might want to use [vsf-mapping-fallback](https://github.com/kodbruket/vsf-mapping-fallback) for some overrides.

 ### Customizing the theme, per store view

 You can run all the `StoreViews` within one, single Vue Storefront instance. It's the default mode. The `StoreViews` are then selected based on the url/path/incoming request headers or env. variables. As simple as it is this mode won't let you apply totally different themes for each individual `StoreView`. It's because the theme files are bundled withing `app.js` bundle provided to the client. Having all themes bundled in will generate a really huge JS bundle and slow down the page in the end.

 You can still customize some UI elements per `storeView` using conditional `v-if` logic and loading specific components within single theme.
 
 **Note:** You can also override some root-level components (like `pages/Category.vue`) by modifying the `theme/router/index.js` routing schema by adding the specific store-view based urls directly in the routing table.

If you really need to use different themes per each individual `storeView` then the best way would be to deploy and execute separate Vue Storefront node instances per each store view (eg. `de` running on port 3000, `it` on 3001 etc); then - make sure your proxy service is routing the request to the proper instance. The instances can have different configs, including different `config.theme` parameter.

Your `nginx` config for this scheme will be something like this:

``` 
ProxyPass / http://localhost:3000/
ProxyPassReverse / http://localhost:3000/

ProxyPass /de http://localhost:3001/de
ProxyPassReverse /de http://localhost:3001/de

ProxyPass /it http://localhost:3002/it
ProxyPassReverse /it http://localhost:3002/it
```
 

## <a id="tip9">Tip 9: HTML minimization, compression, headers</a>

The HTML generated by Vue Storefront can be pretty ... well long :) We're putting a lot of CSS and JS in this single file. More than that there is the whole Vuex state included in the `window.__INITIAL_STATE__` dump in order to support the Client Side data hydration.

To minimze the time the browser will need to download the initial SSR-rendered HTML there are few tricks to be implemented.

### Compression

You might want to enable the `gzip/deflate` or `brotli` compression in the first-line HTTP Server of your choice: `nginx`, `varnish` or `apache`. The good news is that Vue Storefront supports the `gzip` compression as well using the [`compression` Express.js middleware](https://github.com/expressjs/compression). It's enabled by default [in the production mode](https://github.com/DivanteLtd/vue-storefront/blob/develop/src/modules/compress/server.ts).

### HTML Minimzation

The second option is to minimize the HTML, CSS and JS by just removing the white characters. This option is by default on - by the [`config.server.useHtmlMinifier`](https://github.com/DivanteLtd/vue-storefront/blob/5f1e36d611c983de252ce08dea78726b6e10044d/config/default.json#L8) switch. We're using the [html-minifier](https://www.npmjs.com/package/html-minifier) npm package in order to get work done in here. You might want to adjust the [`html-minifier` configuration](https://www.npmjs.com/package/html-minifier#options-quick-reference) by tweaking the `config.server.htmlMinifierOptions` property.


### Headers

You can set various set of different HTTP headers in orders to tweak the edge-caching strategies with your CDN/proxy. You can set the output headers in the `asyncData` of any root-level component.

```js
<script>
export default {
  name: 'RawOutputExample',
  asyncData ({ store, route, context }) {
    context.server.response.setHeader('ETag', 'custom-value')
    context.server.response.setHeader('Cache-Control', 'max-age=533280')
    return new Promise((resolve, reject) => {
      resolve()
    })
  },
  components: {
  }
}
</script>
```

## <a id="tip10">Tip 10: Production catalog indexing + cache invalidation</a>

Although many Vue Storefornt projects are being developed using [mage2vuestorefront](https://github.com/DivanteLtd/mage2vuestorefront/tree/master/src) indexer - it's definitely not a production ready solution. Mostly because of the performance and because it's not fully supporting on-demand indexing (indexing only the changes of products and categories, in real time).

Because of those limitations we created a set of [native indexers](https://medium.com/the-vue-storefront-journal/native-magento-data-indexer-aec3c9ebfb).

The indexers are available for:
- [Magento1](https://github.com/DivanteLtd/magento1-vsbridge-indexer)
- [Magento2](https://github.com/DivanteLtd/magento2-vsbridge-indexer)

The native indexer updates the Elastic Search index in the very same format as the mage2vuestorefront. Our intention was to speed up the indexation process and make it more reliable. With native indexer, we were able to use the Magento2 ORM and events to optimize the indexation process. Please do use this module instead of mage2vuestorefront if you experience any issues regarding indexing performance. Both projects are currently officially supported by the Vue Storefront Core team.

When the SSR caching is enabled (<a href="#tip1">see Tip 1</a>) you need to make sure the indexers are properly configured to refresh exactly the pages that changed.

We're tagging the output pages with [product](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/modules/catalog/helpers/search.ts#L69) and [category](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/modules/catalog/store/category/actions.ts#L121) tags. Then all the indexers including: `magento1-vsbridge-indexer`, `mage2vuestorefront`, `magento2-vsbridge-indexer` will invalidate the cache, by specific product or category ID. It means, the [`invalidate`](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/core/scripts/server.js#L156) method will clear out the cache pages tagged with this specific product id. Note: this URL requires you to pass the invalidation token set in the [config](https://github.com/DivanteLtd/vue-storefront/blob/e96bc3c0d1ef8239bc2e64c399f1fe924cebed36/config/default.json#L12).

The tags can be used to invalidate the Varnish cache, if you're using it. [Read more on that](https://www.drupal.org/docs/8/api/cache-api/cache-tags-varnish).

**Note:**  All the official Vue Storefront data indexers including [magento1-vsbridge-indexer](https://github.com/DivanteLtd/magento1-vsbridge-indexer), [magento2-vsbridge-indexer](https://github.com/DivanteLtd/magento2-vsbridge-indexer) and [mage2vuestorefront](https://github.com/DivanteLtd/mage2vuestorefront) support the cache invalidation. If the cache is enabled in both API and Vue Storefront frontend app, please make sure you are properly using the `config.server.invalidateCacheForwardUrl` config variable as the indexers can send the cache invalidate request only to one URL (frontend or backend) and it **should be forwarded**. Please check the default forwarding URLs in the `default.json` and adjust the `key` parameter to the value of `server.invalidateCacheKey`.

## <a id="tip11">Tip 11: Using Magento Checkout</a>

Vue Storefront Checkout is fully capable of being deployed on production. The thing is by doing so you need to **integrate Vue Storefront with payment providers**. Unfortunately some popular Vue Storefront payment modules ([Stripe](https://forum.vuestorefront.io/t/stripe-payment-integration/155), [Paypal](https://forum.vuestorefront.io/t/paypal-payment-integration/152)) are not supporting the **status notification** changes. This is mostly because the payment modules are **platform agnostic** as well. The status notification changes must be implemented on your own, depending on the platform.

Having this said - one of the other viable options for the Checkout integration is [**Magento Checkout Fallback**](https://forum.vuestorefront.io/t/external-checkout/150) module, maintained by [Vendic](http://vendic.nl). 

When using this module, please make sure you've successfully dispatched the `cart/sync` (VS 1.11), `cart/serverPull` (VS 1.10) action and the sync proces has finished. Otherwise there could be a situation when the sync hasn't been fully executed and user getting to the Magento checkout sees some discrepancies between Magento and Vue Storefront carts. For example - product added to the VSF cart hasn't been yet added to Magento cart.

To avoid this situation you should modify the [beforeEach](https://github.com/Vendic/vsf-external-checkout/blob/baeefd179038b2bd9b4a1a00c95b82b131b61b65/router/beforeEach.ts#L14):


```js
export function beforeEach(to: Route, from: Route, next) {
  const cartToken: string = rootStore.state.cart.cartServerToken;
  const userToken: string = rootStore.state.user.token;
  const externalCheckoutConfig = {...config.externalCheckout};
  const cmsUrl: string = externalCheckoutConfig.cmsUrl;
  const stores = externalCheckoutConfig.stores;
  const storeCode = currentStoreView().storeCode
  const multistoreEnabled: boolean = config.storeViews.multistore

  if (multistoreEnabled) {
    await rootStore.dispatch('cart/sync')
    if (storeCode in stores && to.name === storeCode + '-checkout') {
      window.location.replace(stores[storeCode].cmsUrl + '/vue/cart/sync/token/' + userToken + '/cart/' + cartToken)
    } else if (storeCode in stores && to.name === 'checkout' && stores[storeCode].cmsUrl !== undefined) {
      window.location.replace(stores[storeCode].cmsUrl + '/vue/cart/sync/token/' + userToken + '/cart/' + cartToken)
    } else {
      next()
    }
  } else {
    if (to.name === 'checkout') {
      window.location.replace(cmsUrl + '/vue/cart/sync/token/' + userToken + '/cart/' + cartToken)
    } else {
      next()
    }
  }
}

```

## <a id="tip12">Tip 12: ElasticSearch production setup</a>

ElasticSearch is a viable part of the [`vue-storefront-api`](https://github.com/DivanteLtd/vue-storefront-api) middleware data source. The included Docker files are supposed just for being used in the development mode and they're not ready for production.

ElasticSearch should be run on cluster mode with minimum 3 nodes and having sufficient memory limits (usually it's around 8GB per node minimum). Otherwise ElasticSearch service is not providing the required High Availability level.

Becasue ElasticSearch is a Java service the critical settings are Java Heap size limits - that needs to be set to the limit as high as required to provide Elastic with sufficient memory for the search operations and as low as required for the other parts of OS/services to keep running. To not overrun the container memory limits.

By default, Elasticsearch tells the JVM to use a heap with a minimum and maximum size of 1 GB. When moving to production, it is important to configure heap size to ensure that Elasticsearch has enough heap available.

Quote from the [ElasticSearch documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/heap-size.html)

The value for these settings depends on the amount of RAM available on your server:

- Set Xmx and Xms to no more than 50% of your physical RAM. Elasticsearch requires memory for purposes other than the JVM heap and it is important to leave space for this. For instance, Elasticsearch uses off-heap buffers for efficient network communication, relies on the operating system’s filesystem cache for efficient access to files, and the JVM itself requires some memory too. It is normal to observe the Elasticsearch process using more memory than the limit configured with the Xmx setting.
Set Xmx and Xms to no more than the threshold that the JVM uses for compressed object pointers (compressed oops); the exact threshold varies but is near 32 GB. You can verify that you are under the threshold by looking for a line in the logs like the following:

- heap size `1.9gb`, compressed ordinary object pointers `true`
Ideally set Xmx and Xms to no more than the threshold for zero-based compressed oops; the exact threshold varies but 26 GB is safe on most systems, but can be as large as 30 GB on some systems. You can verify that you are under this threshold by starting Elasticsearch with the JVM options `-XX:+UnlockDiagnosticVMOptions -XX:`+PrintCompressedOopsMode and looking for a line like the following:

```log
heap address: 0x000000011be00000, size: 27648 MB, zero based Compressed Oops
showing that zero-based compressed oops are enabled. If zero-based compressed oops are not enabled then you will see a line like the following instead:

heap address: 0x0000000118400000, size: 28672 MB, Compressed Oops with base: 0x00000001183ff000
```

Read more on [ElasticSearch deployment best practices](https://medium.com/@abhidrona/elasticsearch-deployment-best-practices-d6c1323b25d7)


## <a id="tip13">Tip 13: .htaccess, server side redirects, HTTP codes and headers, middlewares</a>

We strongly recommend using kind of HTTP server as a proxy in front of Vue Storefront. Let it be `nginx` (suggested in our [production setup docs](https://docs.vuestorefront.io/guide/installation/production-setup.html)) or `Varnish` or even `Apache`. Any of those HTTP servers allows you to add some authorization or redirects layer before Vue Storefront.

This is a recommended way.

However, by using [advanced output processing](https://docs.vuestorefront.io/guide/core-themes/layouts.html#how-it-works) you can easily generate any text data output from your Vue Storefront site you want. Including JSON, XML and others. It's a way to generate sitemaps and other data based documents.

The other option is to create a `Express.js` middleware. Our `core/scripts/server.ts` is a classical Node.js application so it should be easy. To do so you might want to create a [server module](https://github.com/DivanteLtd/vue-storefront/blob/develop/src/modules/compress/server.ts).

Server modules are located in `src/modules` and always have the `server.ts` entry point which is responding to one of few server entry points:

- `afterProcessStarted` - executed just [after the server started](https://github.com/DivanteLtd/vue-storefront/blob/2c6e0e1c8e73952beabf550fe4530344a6bcce15/core/scripts/server.ts#L13)
- `afterApplicationInitialized` - executed just [after Express app got initialized](https://github.com/DivanteLtd/vue-storefront/blob/2c6e0e1c8e73952beabf550fe4530344a6bcce15/core/scripts/server.ts#L34). It's a good entry point to bind new request handlers (`app.get(...`, `app.use(...`). Read more on [Express.js request handlers and routing](https://expressjs.com/en/guide/routing.html),
- `beforeOutputRenderedResponse` - executed [after the SSR rendering has been done](https://github.com/DivanteLtd/vue-storefront/blob/2c6e0e1c8e73952beabf550fe4530344a6bcce15/core/scripts/server.ts#L189) but before sending it out to the browser; it let you to override the rendered SSR content with your own,
- `afterOutputRenderedResponse` - executed [after advanced output processing pipeline](https://github.com/DivanteLtd/vue-storefront/blob/2c6e0e1c8e73952beabf550fe4530344a6bcce15/core/scripts/server.ts#L212) executed,
- `beforeCacheInvalidated`, `afterCacheInvalidated` - executed [before and after cache has been invalidated](https://github.com/DivanteLtd/vue-storefront/blob/2c6e0e1c8e73952beabf550fe4530344a6bcce15/core/scripts/server.ts#L76)

Here is an [example how to bind](https://github.com/DivanteLtd/vue-storefront/blob/develop/src/modules/google-cloud-trace/server.ts) tracing module just after server process started:

```js
import { serverHooks } from '@vue-storefront/core/server/hooks'

serverHooks.afterProcessStarted((config) => {
  let trace = require('@google-cloud/trace-agent')
  if (config.has('trace') && config.get('trace.enabled')) {
    trace.start(config.get('trace.config'))
  }
})
```

[Another example](https://github.com/DivanteLtd/vue-storefront/blob/develop/src/modules/compress/server.ts) - pretty common case - binding new Express middleware to process all user requests BEFORE they're processed by SSR rendering pipeline (including custom URL addresses):

```js
import { serverHooks } from '@vue-storefront/core/server/hooks'

const compression = require('compression')
serverHooks.afterApplicationInitialized(({ app, isProd }) => {
  if (isProd) {
    console.log('Output Compression is enabled')
    app.use(compression({ enabled: isProd }))
  }
})
```

If you'd like to bind custom URL address this example can be modified like this:

```js
import { serverHooks } from '@vue-storefront/core/server/hooks'

serverHooks.afterApplicationInitialized(({ app, isProd }) => {
  app.get('/custom-url-address', (req, res) => {
    res.end('Custom response')
  })
})
```