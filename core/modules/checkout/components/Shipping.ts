import { mapState, mapGetters } from 'vuex'
import RootState from '@vue-storefront/core/types/RootState'
import toString from 'lodash-es/toString'
import { TaskQueue } from '@vue-storefront/core/lib/sync'
import { Logger } from '@vue-storefront/core/lib/logger'
import config from 'config';
const Countries = require('@vue-storefront/i18n/resource/countries.json')

export const getShippingMethods = async (): Promise<any> => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    const task = await TaskQueue.execute({
      url: config.api.url + '/api/cart/shipping-methods',
      payload: {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      },
      mode: 'cors'
      // silent: true
    })
    return task.result;
  } catch (err) {
    console.error('error', err)
  }
}

export const Shipping = {
  name: 'Shipping',
  props: {
    isActive: {
      type: Boolean,
      required: true
    }
  },
  beforeDestroy () {
    this.$bus.$off('checkout-after-load', this.onCheckoutLoad)
    this.$bus.$off('checkout-after-personalDetails', this.onAfterPersonalDetails)
    this.$bus.$off('checkout-after-shippingset', this.onAfterShippingSet)
  },
  beforeMount () {
    this.$bus.$on('checkout-after-load', this.onCheckoutLoad)
    this.$bus.$on('checkout-after-personalDetails', this.onAfterPersonalDetails)
    this.$bus.$on('checkout-after-shippingset', this.onAfterShippingSet)
  },
  data () {
    // debugger;
    return {
      isFilled: false,
      countries: Countries,
      shipping: this.$store.state.checkout.shippingDetails,
      shipToMyAddress: false,
      myAddressDetails: {
        firstname: '',
        lastname: '',
        country: '',
        region: '',
        city: '',
        street: ['', ''],
        postcode: '',
        telephone: ''
      }
      // shippingMethods: this.getShippingMethod()
    }
  },
  computed: {
    ...mapState({
      currentUser: (state: RootState) => state.user.current
    }),
    ...mapGetters({
      shippingMethods: 'checkout/getShippingMethods'
    }),
    checkoutShippingDetails () {
      return this.$store.state.checkout.shippingDetails
    },
    paymentMethod () {
      return this.$store.getters['checkout/getPaymentMethods']
    }
  },
  watch: {
    shippingMethods: {
      handler () {
        this.checkDefaultShippingMethod()
      }
    },
    shipToMyAddress: {
      handler () {
        this.useMyAddress()
      },
      immediate: true
    }
  },
  mounted () {
    this.checkDefaultShippingAddress()
    this.checkDefaultShippingMethod()
    this.changeShippingMethod()
  },
  methods: {
    checkDefaultShippingAddress () {
      this.shipToMyAddress = this.hasShippingDetails()
    },
    checkDefaultShippingMethod () {
      if (!this.shipping.shippingMethod || this.notInMethods(this.shipping.shippingMethod)) {
        let shipping = this.shippingMethods.find(item => item.default)
        if (!shipping && this.shippingMethods && this.shippingMethods.length > 0) {
          shipping = this.shippingMethods[0]
        }
        this.shipping.shippingMethod = shipping.method_code
        this.shipping.shippingCarrier = shipping.carrier_code
      }
    },
    onAfterShippingSet (receivedData) {
      this.shipping = receivedData
      this.isFilled = true
    },
    onAfterPersonalDetails (receivedData) {
      if (!this.isFilled) {
        this.$store.dispatch('checkout/updatePropValue', ['firstName', receivedData.firstName])
        this.$store.dispatch('checkout/updatePropValue', ['lastName', receivedData.lastName])
      }
    },
    sendDataToCheckout () {
      this.$bus.$emit('checkout-after-shippingDetails', this.shipping, this.$v)
      this.isFilled = true
    },
    edit () {
      if (this.isFilled) {
        this.$bus.$emit('checkout-before-edit', 'shipping')
      }
    },
    hasShippingDetails () {
      if (this.currentUser) {
        if (this.currentUser.hasOwnProperty('default_shipping')) {
          let id = this.currentUser.default_shipping
          let addresses = this.currentUser.addresses
          for (let i = 0; i < addresses.length; i++) {
            if (toString(addresses[i].id) === toString(id)) {
              this.myAddressDetails = addresses[i]
              return true
            }
          }
        }
      }
      return false
    },
    useMyAddress () {
      if (this.shipToMyAddress) {
        this.$set(this, 'shipping', {
          firstName: this.myAddressDetails.firstname,
          lastName: this.myAddressDetails.lastname,
          country: this.myAddressDetails.country_id,
          state: this.myAddressDetails.region.region ? this.myAddressDetails.region.region : '',
          city: this.myAddressDetails.city,
          streetAddress: this.myAddressDetails.street[0],
          apartmentNumber: this.myAddressDetails.street[1],
          zipCode: this.myAddressDetails.postcode,
          phoneNumber: this.myAddressDetails.telephone,
          shippingMethod: this.checkoutShippingDetails.shippingMethod,
          shippingCarrier: this.checkoutShippingDetails.shippingCarrier
        })
      } else {
        this.$set(this, 'shipping', this.checkoutShippingDetails)
      }
      this.changeCountry()
    },
    getShippingMethod () {
      // debugger;
      try {
        // this.shippingMethods = await getShippingMethods()
        // this.shippingMethods = this.shippingMethods.shippingMethods
        // this.$store.checkout.shipping = this.shippingMethods
        // debugger;
        for (let i = 0; i < this.shippingMethods.length; i++) {
          // debugger;
          if (this.shippingMethods[i].method_code === this.shipping.shippingMethod) {
            // debugger;
            return {
              method_title: this.shippingMethods[i].method_title,
              amount: this.shippingMethods[i].amount
            }
          }
        }
        return {
          method_title: '',
          amount: ''
        }
      } catch (err) {
        Logger.debug('Unable to load shipping methods ' + err)()
      }
    },
    getCountryName () {
      for (let i = 0; i < this.countries.length; i++) {
        if (this.countries[i].code === this.shipping.country) {
          return this.countries[i].name
        }
      }
      return ''
    },
    changeCountry () {
      this.$bus.$emit('checkout-before-shippingMethods', this.shipping.country)
    },
    getCurrentShippingMethod () {
      let shippingCode = this.shipping.shippingMethod
      console.log('shippingcode: ', shippingCode)
      let currentMethod = this.shippingMethods ? this.shippingMethods.find(item => item.method_code === shippingCode) : {}
      return currentMethod
    },
    changeShippingMethod () {
      let currentShippingMethod = this.getCurrentShippingMethod()
      // debugger;
      if (currentShippingMethod) {
        this.shipping = Object.assign(this.shipping, { shippingCarrier: currentShippingMethod.carrier_code })
        this.$bus.$emit('checkout-after-shippingMethodChanged', {
          country: this.shipping.country,
          method_code: currentShippingMethod.method_code,
          carrier_code: currentShippingMethod.carrier_code,
          payment_method: this.paymentMethod[0].code
        })
      }
    },
    notInMethods (method) {
      // debugger;
      let availableMethods = this.shippingMethods
      if (availableMethods.find(item => item.method_code === method)) {
        return false
      }
      return true
    },
    onCheckoutLoad () {
      this.shipping = this.$store.state.checkout.shippingDetails
    }
  }
}
