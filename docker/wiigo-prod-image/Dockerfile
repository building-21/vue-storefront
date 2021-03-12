FROM node:10-alpine

ENV VS_ENV prod

WORKDIR /var/www

# App

COPY package.json ./
COPY yarn.lock ./

# Install app dependencies
RUN apk add --no-cache --virtual .build-deps ca-certificates \
  && apk add --no-cache git \
  && apk del .build-deps

COPY ./babel.config.js	    /var/www/babel.config.js
COPY ./config           	  /var/www/config
COPY ./core	                /var/www/core
COPY ./ecosystem.json	      /var/www/ecosystem.json
COPY ./.eslintignore	      /var/www/.eslintignore
COPY ./.eslintrc.js	        /var/www/.eslintrc.js
COPY ./lerna.json	          /var/www/lerna.json
COPY ./tsconfig.json	      /var/www/tsconfig.json
COPY ./tsconfig-build.json	/var/www/tsconfig-build.json
COPY ./shims.d.ts	          /var/www/shims.d.ts
COPY ./package.json	        /var/www/package.json
COPY ./src              	  /var/www/src
COPY ./var              	  /var/www/var
COPY ./packages	            /var/www/packages


COPY dist /var/www/dist

RUN yarn install

#COPY ./node_modules/@vue-storefront/   ./node_modules/@vue-storefront/

COPY config/custom-environment-variables.json ./config/

EXPOSE  3000
#CMD ["node", "/src/index.js"]
#RUN yarn start

ENTRYPOINT ["./node_modules/.bin/ts-node", "-P" ,"tsconfig-build.json", "./core/scripts/server.ts"]