FROM node:20-bookworm AS build

WORKDIR /plugin

COPY package*.json ./
RUN npm install

COPY . .
RUN npm test
RUN npm run build
RUN npm run package

FROM scratch AS artifact
COPY --from=build /plugin/dist/pr-review-for-obsidian/ /pr-review-for-obsidian/
