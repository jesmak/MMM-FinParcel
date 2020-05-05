'use strict';

const NodeHelper = require('node_helper');
const request = require('request');

module.exports = NodeHelper.create({

    postiQuery: '{"query":"{ shipment { courier { country, name } shipmentType shipmentNumber grossWeight height width depth volume parties { name role location { city country } } departure { city country } destination { city country } trackingNumbers events { eventLocation { city country } eventShortName { lang value } timestamp } status { statusCode description { lang value } } shipmentPhase estimatedDeliveryTime lastPickupDate savedDateTime updatedDateTime confirmedEarliestDeliveryTime confirmedLatestDeliveryTime } }"}',	
	postiLoginUrl: 'https://oma.posti.fi/api/auth/v1/login',
	postiQueryUrl: 'https://oma.posti.fi/graphql/v2',
	querying: false,
	postiToken: null,
	matkahuoltoLoginUrl: 'https://wwwservice.matkahuolto.fi/user/auth',
	matkahuoltoQueryUrl: 'https://wwwservice.matkahuolto.fi/history/parcel/received/',
	matkahuoltoDetailsQueryUrl: 'https://wwwservice.matkahuolto.fi/search/trackingInfo?parcelNumber=', 
	matkahuoltoLanguageParameter: '&language=',
	parcels: [],
	
    init: function() {

    },

    socketNotificationReceived: function (notification, payload) {

        const self = this;

		if (notification === "MMM-FinParcel_UPDATE_DATA" && this.querying == false) {

			this.querying = true;
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

		if (this.postiToken == null) {
		
			var options = { uri: this.postiLoginUrl, method: 'POST', json: { user: config.postiUserName, password: config.postiPassword } };

			request(options, function (error, response, body) {
				
				if (error) {
					console.error(error);
					self.querying = false;
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

		var options = { 
			uri: self.postiQueryUrl, 
			method: 'POST', 
			body: self.postiQuery, 
			headers: { 'Authorization': 'Bearer ' + this.postiToken, 'Content-Type': 'application/json;charset=UTF-8' } 
		};
		
		request(options, function (error, response, body) {

			if (error) {
				console.error(error);
				self.postiToken = null;
				self.querying = false;
			}
			else {
				var postiParcels = JSON.parse(body);
				self.parcels = postiParcels.data.shipment.map(p => { 
					return {
						sender: p.parties.find(x => x.role == 'CONSIGNOR').name.join(", "), 
						destination: (p.parties.find(x => x.role == 'DELIVERY') || p.parties.find(x => x.role == 'CONSIGNEE')).name.slice(-1)[0], 
						receiverCity: p.destination.city,
						senderCity: p.departure.city,
						shipmentNumber: p.trackingNumbers[0],
						shipmentDate: new Date(p.savedDateTime),
						status: self.getPostiStatus(p.shipmentPhase),
						rawStatus: p.shipmentPhase,
						latestEvent: (p.events.slice(-1)[0].eventShortName.find(x => x.lang == config.language) || 
									  p.events.slice(-1)[0].eventShortName.find(x => x.lang == 'en')).value,
						latestEventCountry: p.events.slice(-1)[0].eventLocation.country,
						latestEventCity: p.events.slice(-1)[0].eventLocation.city,
						latestEventDate: new Date(p.events.slice(-1)[0].timestamp)
					};
				});
				
				if (matkahuoltoEnabled) {
					self.getMatkahuoltoParcels(config);
				}
				else {
					self.querying = false;
					self.sendParcelsNotification(config);
				}
			}
		});
	},

	getPostiStatus: function(status) {
		switch (status) {
			case 'DELIVERED':
				return 1;
			case 'IN_TRANSPORT':
				return 5;
			default:
				return 8; // Unknown
		}
	},

    getMatkahuoltoParcels: function (config) {

		const self = this;

		if (this.matkahuoltoToken == null) {
		
			var options = { uri: this.matkahuoltoLoginUrl, method: 'POST', json: { username: config.matkahuoltoUserName, password: config.matkahuoltoPassword } };

			request(options, function (error, response, body) {
				
				if (error) {
					console.error(error);
					self.querying = false;
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
		
		var options = { 
			uri: this.matkahuoltoQueryUrl, 
			method: 'GET', 
			headers: { 'Authorization': this.matkahuoltoToken, 'Content-Type': 'application/json' } 
		};
		
		request(options, function (error, response, body) {

			if (error) {
				console.error(error);
				self.matkahuoltoToken = null;
				self.querying = false;
			}
			else {
				let matkahuoltoParcels = JSON.parse(body).shipments.map(p => { 
					return {
						sender: p.senderName, 
						destination: p.destinationPlaceName,
						receiverCity: p.receiverCity,
						senderCity: p.senderCity,
						shipmentNumber: p.shipmentNumber,
						latestEventDate: self.timestampToDate(p.shipmentDate / 1000),
						status: self.getMatkahuoltoStatus(p.shipmentStatus),
						rawStatus: p.shipmentStatus,
						detailsRetrieved: false
					};
				});

				matkahuoltoParcels.forEach(function(parcel) {
					self.queryMatkahuoltoParcelDetails(parcel, matkahuoltoParcels, config);
				});
			}
		});
	},
	
	queryMatkahuoltoParcelDetails(parcel, parcels, config) {
	
		const self = this;
		
		var options = { 
			uri: this.matkahuoltoDetailsQueryUrl + parcel.shipmentNumber + this.matkahuoltoLanguageParameter + config.language, 
			method: 'GET', 
			headers: { 'Authorization': this.matkahuoltoToken, 'Content-Type': 'application/json' } 
		};
		
		request(options, function (error, response, body) {

			parcel.detailsRetrieved = true;

			if (error) {
				console.error(error);
			}
			else {
				let matkahuoltoParcel = JSON.parse(body);
				parcel.latestEvent = matkahuoltoParcel.trackingEvents[0].description,
				parcel.latestEventCity = matkahuoltoParcel.trackingEvents[0].place,
				parcel.shipmentDate = self.getMatkahuoltoEventDate(matkahuoltoParcel.trackingEvents.slice(-1)[0].date, matkahuoltoParcel.trackingEvents.slice(-1)[0].time)				
			}
			
			if (parcels.every(p => p.detailsRetrieved)) {
				self.parcels = self.parcels.concat(parcels);
				self.sendParcelsNotification(config);
				self.querying = false;
			}
		});	
	},
	
	getMatkahuoltoStatus: function(status) {
		switch (status) {
			case '02':
				return 7; // Info received
			case '20':
				return 6; // Pending
			case '30':
				return 5; // In transit
			default:
				return 8; // Unknown
		}
	},
	
	getMatkahuoltoEventDate: function(date, time) {
		return date.substr(6, 4) + '-' + date.substr(3, 2) + '-' + date.substr(0, 2) + 'T' + time.substr(0, 2) + ':' + time.substr(3, 2) + ':00Z';
	},
	
	timestampToDate: function(timestamp) {
		var date = new Date(0);
		date.setUTCSeconds(timestamp);
		return date;
	},
	
	sendParcelsNotification: function(config) {
		
		if (config.showDeliveredDays >= 0) {
			this.parcels = this.parcels.filter(x => 
				x.status != 1 ||
				Math.round((new Date().getTime() - x.latestEventDate.getTime()) / (1000 * 60 * 60 * 24)) < config.showDeliveredDays);
		}

		this.parcels = this.parcels.sort(function(a, b) {
			return a.status != b.status ? b.status - a.status : b.lastEventDate.getTime() - a.lastEventDate.getTime();
		});
		
		if (config.limit > 0) {
			this.parcels = this.parcels.slice(0, config.limit);
		}
		
		this.sendSocketNotification('MMM-FinParcel_DATA_RECEIVED', this.parcels);
	}
});
