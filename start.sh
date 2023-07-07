rm /root/.forever/creaexpbot.log
echo $1 | sudo -S forever start --uid creaexpbot index.js
echo "Started..."