FROM node:20.7.0

# Set the timezone to CST
ENV TZ=America/Chicago

WORKDIR /usr/src/app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD [ "npm", "start" ]