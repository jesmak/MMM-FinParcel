'use strict'

Module.register('MMM-FinParcel',{

    defaults: {
		postiUserName: '',
    	postiPassword: '',
		matkahuoltoUserName: '',
    	matkahuoltoPassword: '',
    	limit: 7,
    	updateInterval: 180,
		showDeliveredDays: 7,
		statusTranslations: ["Delivered", "Info received", "Pending", "In transit", "Being delivered", "Ready for pickup", "Exception"],
		loadingTranslation: "Loading parcel data...",
		noParcelsTranslation: "No parcel data found",
		errorTranslation: "Error loading parcel data",
		language: "en",
		showFromTo: true
    },

	parcels: [],
	loaded: false,
	error: false,
	
	parcelIcons: [ 
		"fa fa-check-square-o fa-fw", "fa fa-file-text-o fa-fw", "fa fa-clock-o fa-fw", "fa fa-exchange fa-fw", "fa fa-truck fa-fw", 
		"fa fa-check-square-o fa-fw", "fa fa-exclamation-triangle fa-fw", "fa fa-question-circle fa-fw"
	],

	parcelIconColors: ["grey", "cornflowerblue", "cornflowerblue", "green", "green", "green", "red", "red"],

    start: function() {
		var self = this;
		this.getData();
		setInterval(function () {
			self.getData();
		}, self.config.updateInterval * 60000);		
    },
	
    getStyles: function () {
        return [
            'font-awesome.css',
            'MMM-FinParcel.css'
        ];
    },	
	
	getScripts: function () {
		return ["moment.js"];
	},
	
	getData: function() {
        this.sendSocketNotification("MMM-FinParcel_UPDATE_DATA", this.config);
	},

    socketNotificationReceived: function (notification, payload) {
		if (notification === "MMM-FinParcel_LOGGER") {
			console.log(payload);
		}
		else if (notification === "MMM-FinParcel_ERROR") {
			console.error(payload);
            this.parcels = [];
			this.error = true;
            this.updateDom();
		}
		else if (notification === "MMM-FinParcel_DATA_RECEIVED") {
            if (this.loaded == false || JSON.stringify(this.parcels) !== JSON.stringify(payload)) {
				this.loaded = true;
                this.parcels = payload;
				this.error = false;
                this.updateDom();
            }
        }
    },
	
	getDom: function() {
	
		const wrapper = document.createElement('div');
		
		if (!this.loaded) {
			wrapper.innerHTML = this.config.loadingTranslation;
			wrapper.classList.add("light", "small");
			return wrapper;
		}
		else if (this.error) {
			wrapper.innerHTML = this.config.errorTranslation;
			wrapper.classList.add("light", "small");
			return wrapper;
		}
		else if (this.parcels.length == 0) {
			wrapper.innerHTML = this.config.noParcelsTranslation;
			wrapper.classList.add("light", "small");
			return wrapper;
		}
		else {
			
			var self = this;
			
			const table = document.createElement('table');
			table.className = 'small';
			
			this.parcels.forEach(function(parcel) {
				
				let header = document.createElement('tr');
				self.addIconCell(header, self.parcelIcons[parcel.status] + ' finParcelHeaderIcon', self.parcelIconColors[parcel.status]);
				self.addValueCell(
					header, 
					parcel.shipmentNumber + ' (' + (parcel.status == 7 ? parcel.rawStatus : self.config.statusTranslations[parcel.status]) + ')',
					'finParcelHeader');
				
				let dateCell = document.createElement('td');
				dateCell.className = 'finParcelTimeCell ';
				dateCell.innerHTML = moment(parcel.latestEventDate).format('D.M.YYYY HH:mm');
				header.appendChild(dateCell);
				
				table.appendChild(header);

				if (self.config.showFromTo && (parcel.sender || parcel.senderCity)) {
					let sender = document.createElement('tr');
					self.addIconCell(sender, 'fa-fw');
					self.addIconCell(sender, 'fa fa-long-arrow-alt-right fa-fw');
					self.addValueCell(sender, parcel.sender || parcel.senderCity, 'finParcelLabel');
					table.appendChild(sender);
				}

				if (self.config.showFromTo && (parcel.destination || parcel.receiverCity)) {
					let receiver = document.createElement('tr');
					self.addIconCell(receiver, 'fa-fw');
					self.addIconCell(receiver, 'fa fa-long-arrow-alt-left fa-fw');
					self.addValueCell(receiver, parcel.destination || parcel.receiverCity, 'finParcelLabel');
					table.appendChild(receiver);
				}

				if (parcel.latestEvent) {

					let eventTitle = document.createElement('tr');
					self.addIconCell(eventTitle, 'fa-fw');
					self.addIconCell(eventTitle, 'fa fa-calendar-day fa-fw');
					
					let event = parcel.latestEvent;

					if (parcel.latestEventCountry || parcel.latestEventCity) {
					
						event += ' (';

						if (parcel.latestEventCity) {
							
							event += parcel.latestEventCity;
							
							if (parcel.latestEventCountry) {
								event += ', ';
							}
						}

						if (parcel.latestEventCountry) {
							event += parcel.latestEventCountry;
						}
						
						event += ')';
					}
					
					self.addValueCell(eventTitle, event, 'finParcelLabel');
					table.appendChild(eventTitle);
				}
			});
			
			wrapper.appendChild(table);
		}
		
        return wrapper;
    },
	
	addIconCell: function(row, iconClass, color) {
		let spacer = document.createElement('td');
		spacer.className = 'finParcelIconCell';
		let spacerI = document.createElement('i');
		spacerI.className = iconClass;
		if (color) {
			spacerI.style.color = color;
		}
		spacer.appendChild(spacerI);
		row.appendChild(spacer);
	},
	
	addValueCell: function(row, text, className) {
		let cell = document.createElement('td');
		cell.colSpan = "2";
		cell.className = "no-wrap " + className;
		cell.innerHTML = text;
		row.appendChild(cell);
	}
});
