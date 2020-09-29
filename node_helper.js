'use strict';

const NodeHelper = require('node_helper');
const request = require('request');

module.exports = NodeHelper.create({

    postiQuery: '{"query":"{ shipment { courier { country, name } shipmentType shipmentNumber grossWeight height width depth volume parties { name role location { city country } } departure { city country } destination { city country } trackingNumbers events { eventLocation { city country } eventShortName { lang value } eventDescription { lang value } timestamp } status { statusCode description { lang value } } shipmentPhase estimatedDeliveryTime lastPickupDate savedDateTime updatedDateTime confirmedEarliestDeliveryTime confirmedLatestDeliveryTime } }"}',	
	postiLoginUrl: 'https://oma.posti.fi/api/auth/v1/login',
	postiQueryUrl: 'https://oma.posti.fi/graphql/v2',
	postiToken: null,
	matkahuoltoToken: null,
	matkahuoltoLoginUrl: 'https://wwwservice.matkahuolto.fi/user/auth',
	matkahuoltoQueryUrl: 'https://wwwservice.matkahuolto.fi/history/parcel/received/',
	matkahuoltoDetailsQueryUrl: 'https://wwwservice.matkahuolto.fi/search/trackingInfo?parcelNumber=', 
	matkahuoltoLanguageParameter: '&language=',
	parcels: [],
	
    init: function() {

    },

    socketNotificationReceived: function (notification, payload) {

        const self = this;

		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Update notification received');

		if (notification === "MMM-FinParcel_UPDATE_DATA") {

			this.parcels = [];
			
			var postiEnabled = payload.postiUserName && payload.postiUserName.length && payload.postiPassword && payload.postiPassword.length;
			var matkahuoltoEnabled = payload.matkahuoltoUserName && payload.matkahuoltoUserName.length && payload.matkahuoltoPassword && payload.matkahuoltoPassword.length;

			if (postiEnabled) {
				this.getPostiParcels(payload, matkahuoltoEnabled);
			}
			else if (matkahuoltoEnabled) {
				this.getMatkahuoltoParcels(payload);
			}
		}
    },
	

    getPostiParcels: function (config, matkahuoltoEnabled) {
		
        const self = this;

		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Updating Posti parcels...');

		if (this.postiToken == null) {
		
			self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Authenticating to Posti API');
		
			var options = { uri: this.postiLoginUrl, method: 'POST', json: { user: config.postiUserName, password: config.postiPassword } };

			request(options, function (error, response, body) {
				
				if (error) {
					self.sendSocketNotification('MMM-FinParcel_ERROR', { error: error, response: response, body: body });
					console.error(error);
				}
				else {
					self.postiToken = body;
					self.queryPostiParcels(config, matkahuoltoEnabled);
				}
			});
		}
		else {
			this.queryPostiParcels(config, matkahuoltoEnabled);
		}
    },

	queryPostiParcels: function(config, matkahuoltoEnabled) {

		var self = this;

		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Loading parcel data from Posti API');

		var options = { 
			uri: self.postiQueryUrl, 
			method: 'POST', 
			body: self.postiQuery, 
			headers: { 'Authorization': 'Bearer ' + this.postiToken, 'Content-Type': 'application/json;charset=UTF-8' } 
		};
		
		request(options, function (error, response, body) {

			self.postiToken = null;

			if (error) {
				self.sendSocketNotification('MMM-FinParcel_ERROR', { error: error, response: response, body: body });
				console.error(error);
			}
			else {
				self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Parcel data loaded from Posti API');
				var postiParcels = JSON.parse(body);
				self.parcels = postiParcels.data.shipment.map(p => { 
					return {
						sender: p.parties.find(x => x.role == 'CONSIGNOR').name.join(", "), 
						destination: (p.parties.find(x => x.role == 'DELIVERY') || p.parties.find(x => x.role == 'CONSIGNEE')).name.join(", "), 
						receiverCity: p.destination.city,
						senderCity: p.departure.city,
						shipmentNumber: p.trackingNumbers[0] || p.shipmentNumber,
						shipmentDate: new Date(p.savedDateTime),
						status: self.getPostiStatus(p.shipmentPhase),
						rawStatus: p.shipmentPhase,
						latestEvent: (p.events.slice(-1)[0].eventDescription.find(x => x.lang == config.language) || 
									  p.events.slice(-1)[0].eventDescription.find(x => x.lang == 'en')).value,
						latestEventCountry: p.events.slice(-1)[0].eventLocation.country,
						latestEventCity: p.events.slice(-1)[0].eventLocation.city,
						latestEventDate: new Date(p.events.slice(-1)[0].timestamp)
					};
				});
				
				if (matkahuoltoEnabled) {
					self.getMatkahuoltoParcels(config);
				}
				else {
					self.sendParcelsNotification(config);
				}
			}
		});
	},

	getPostiStatus: function(status) {
		switch (status) {
			case 'WAITING':
				return 1;
			case 'RECEIVED':
				return 2;
			case 'IN_TRANSPORT':
				return 3;
			case 'IN_DELIVERY':
				return 4;
			case 'READY_FOR_PICKUP':
				return 5;
			case 'RETURNED_TO_SENDER':
				return 6;
			case 'DELIVERED':
				return 0;
			default:
				return 7; // Unknown
		}
	},

    getMatkahuoltoParcels: function (config) {

		const self = this;

		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Updating Matkahuolto parcels...');

		if (this.matkahuoltoToken == null) {
		
			self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Authenticating to Matkahuolto API');

			var options = { uri: this.matkahuoltoLoginUrl, method: 'POST', json: { username: config.matkahuoltoUserName, password: config.matkahuoltoPassword } };

			request(options, function (error, response, body) {
				
				if (error) {
					self.sendSocketNotification('MMM-FinParcel_ERROR', { error: error, response: response, body: body });
					console.error(error);
				}
				else {
					self.matkahuoltoToken = body.AuthenticationResult.AccessToken;
					self.queryMatkahuoltoParcels(config);
				}
			});
		}
		else {
			this.queryMatkahuoltoParcels(config);
		}
	},
	
	queryMatkahuoltoParcels: function(config) {
		
		const self = this;
		
		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Loading parcel data from Matkahuolto API');

		var options = { 
			uri: this.matkahuoltoQueryUrl, 
			method: 'GET', 
			headers: { 'Authorization': this.matkahuoltoToken, 'Content-Type': 'application/json' } 
		};
		
		request(options, function (error, response, body) {

			if (error) {
				self.sendSocketNotification('MMM-FinParcel_ERROR', { error: error, response: response, body: body });
				console.error(error);
				self.matkahuoltoToken = null;
			}
			else {

				self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Parcel data loaded from Matkahuolto API');

				let matkahuoltoParcels = JSON.parse(body).shipments.map(p => { 
					return {
						sender: p.senderName, 
						destination: p.destinationPlaceName,
						receiverCity: p.receiverCity,
						senderCity: p.senderCity,
						shipmentNumber: p.shipmentNumber,
						status: self.getMatkahuoltoStatus(p.shipmentStatus),
						rawStatus: p.shipmentStatus,
						detailsRetrieved: false
					};
				});

				if (matkahuoltoParcels.length > 0) {
					matkahuoltoParcels.forEach(function(parcel) {
						self.queryMatkahuoltoParcelDetails(parcel, matkahuoltoParcels, config);
					});
				}
				else {
					self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Finished loading all parcel details from Matkahuolto API');
					self.sendParcelsNotification(config);
					self.matkahuoltoToken = null;
				}
			}
		});
	},
	
	queryMatkahuoltoParcelDetails(parcel, parcels, config) {
	
		const self = this;
		
		self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Loading parcel details from Matkahuolto API for shipment ' + parcel.shipmentNumber);

		var options = { 
			uri: this.matkahuoltoDetailsQueryUrl + parcel.shipmentNumber + this.matkahuoltoLanguageParameter + config.language, 
			method: 'GET', 
			headers: { 'Authorization': this.matkahuoltoToken, 'Content-Type': 'application/json' } 
		};
		
		request(options, function (error, response, body) {

			parcel.detailsRetrieved = true;

			if (error) {
				self.sendSocketNotification('MMM-FinParcel_ERROR', { error: error, response: response, body: body });
				console.error(error);
			}
			else {
				self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Parcel details loaded from Matkahuolto API for shipment ' + parcel.shipmentNumber);
				let matkahuoltoParcel = JSON.parse(body);
				parcel.latestEvent = matkahuoltoParcel.trackingEvents[0].description,
				parcel.latestEventCity = matkahuoltoParcel.trackingEvents[0].place,
				parcel.latestEventDate = self.getMatkahuoltoEventDate(matkahuoltoParcel.trackingEvents[0].date, matkahuoltoParcel.trackingEvents[0].time),
				parcel.shipmentDate = self.getMatkahuoltoEventDate(matkahuoltoParcel.trackingEvents.slice(-1)[0].date, matkahuoltoParcel.trackingEvents.slice(-1)[0].time)				
			}
			
			if (parcels.every(p => p.detailsRetrieved)) {
				self.sendSocketNotification('MMM-FinParcel_LOGGER', 'Finished loading all parcel details from Matkahuolto API');
				self.parcels = self.parcels.concat(parcels);
				self.sendParcelsNotification(config);
				self.matkahuoltoToken = null;
			}
		});	
	},
	
	getMatkahuoltoStatus: function(status) {

		var code = parseInt(status);

		if (code >= 60) {
			return 0;
		}
		else if (code >= 50) {
			return 5;
		}
		else if (code >= 40) {
			return 4;
		}
		else if (code >= 30) {
			return 3;
		}
		else if (code >= 20) {
			return 2;
		}
		else {
			return 1;
		}
	},
	
	getMatkahuoltoEventDate: function(date, time) {
		return new Date(date.substr(6, 4) + '-' + date.substr(3, 2) + '-' + date.substr(0, 2) + 'T' + time.substr(0, 2) + ':' + time.substr(3, 2) + ':00Z');
	},
	
	timestampToDate: function(timestamp) {
		var date = new Date(0);
		date.setUTCSeconds(Math.round(timestamp));
		return date;
	},
	
	sendParcelsNotification: function(config) {
		
		this.sendSocketNotification('MMM-FinParcel_LOGGER', 'Sending update notification to UI');
		
		if (config.showDeliveredDays >= 0) {
			this.parcels = this.parcels.filter(x => 
				x.status != 0 ||
				Math.round((new Date().getTime() - x.latestEventDate.getTime()) / (1000 * 60 * 60 * 24)) < config.showDeliveredDays);
		}

		this.parcels = this.parcels.sort(function(a, b) {
			return b.latestEventDate.getTime() - a.latestEventDate.getTime();
		});
		
		if (config.limit > 0) {
			this.parcels = this.parcels.slice(0, config.limit);
		}
		
		this.sendSocketNotification('MMM-FinParcel_DATA_RECEIVED', this.parcels);
	}
});
