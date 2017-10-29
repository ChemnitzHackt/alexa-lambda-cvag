var https = require('https')

exports.handler = (event, context) => {

  try {
    if (event.session.new) {
      console.log("NEW SESSION")
    }

    switch (event.request.type) {
      case "LaunchRequest":
        console.log(`LAUNCH REQUEST`);
        
        swear().then((word) => {
            context.succeed(speak("Moin, moin."))
        })
        
        break;
      case "IntentRequest":
            switch(event.request.intent.name) {
            case "Departure":
                console.log("Starting departure intent.");
                console.log(JSON.stringify(event, null, 4));
                
                if (!event.request.dialogState || event.request.dialogState == "STARTED" || event.request.dialogState == "IN_PROGRESS") {
                    context.succeed(delegateDialog());
                } else {
                    let slot = event.request.intent.slots.station;
                    let resolved = resolveValue(event, 'station');
                    if("NONE" === slot.confirmationStatus) {
                        findStation(resolved).then((station) => {
                            if(!station) {
                                context.succeed(speak(`Ich konnte keine Haltestelle für ${resolved} finden.`))
                            }
                            
                            let question = `Ich habe ${resolved} verstanden `;
                            if (resolved.toLowerCase() != station.displayName.toLowerCase()) {
                                question += `und Haltestelle Nummer ${station.number}, ${station.displayName} gefunden. `;
                            }
                            question += `Ist das korrekt?`;
                            
                            let result = speak(question);
                            result.response.shouldEndSession = false;
                            result.response.directives = [{
                                "type": "Dialog.ConfirmSlot",
                                "slotToConfirm": "station"
                            }];
                            
                            context.succeed(result);
                        })
                    } else {
                        const p1 = findStation(resolved);
                        const p2 = p1.then((station) => {
                            return departures(station.mandator + "-" + station.number)
                        });
                        
                        Promise.all([p1, p2, tip()]).then(([station, departures, t]) => {
                            console.log("Finished fetching information.")
                            console.log(JSON.stringify(station, null, 4));
                            console.log(JSON.stringify(departures, null, 4));
                            
                            if (departures.length < 1) {
                                context.succeed(speak(`Ich konnte leider keine Abfahrten von der Haltestelle ${station.displayName} finden.`))
                            }
                            
                            let answer = `An der Haltestelle ${station.displayName} halten folgende Linien. `;
                            const now = new Date();
                            for (let i = 0; i < Math.min(3, departures.length); ++i) {
                                const stop = departures[i];
                                const date = new Date(stop.actualDeparture);
                                const diff = Math.floor((date - now) / 60 / 1000);
                                const plural = (diff != 1) ? "n" : ""
                                answer += `Linie ${stop.line} in Richtung ${stop.destination} in ${diff} Minute${plural} ${sayTime(date)}. `;
                            }
                            
                            console.log(t);
                            answer += " ";
                            answer += t;
                            
                            context.succeed(speak(answer));
                        });
                    }
                }
                break;
            default:
                throw "Invalid intent"
                break;
            }
        break;
      case "SessionEndedRequest":
          console.log(`SESSION ENDED REQUEST`);
          console.log(JSON.stringify(event, null, 4));
        break;
      default:
        context.fail(`INVALID REQUEST TYPE: ${event.request.type}`)
    }

  } catch(error) { 
      console.log(JSON.stringify(error, null, 4))
      context.fail(`Exception: ${error}`) 
  }
}

delegateDialog = () => {
    return {
        "version": "1.0",
        "response": {
            "directives": [
                {
                    "type": "Dialog.Delegate"
                }
            ],
            "shouldEndSession": false
        },
        "sessionAttributes": {}
    }
}

resolveText = (event, slotName) => {
    console.log(JSON.stringify(event.request.intent.slots, null, 4));
    
    var slot = event.request.intent.slots[slotName];
    var value = slot.value && slot.value.toLowerCase(); 
    var resolutions = slot && slot.resolutions && slot.resolutions.resolutionsPerAuthority;
    var resolved = resolutions && resolutions[0].values && resolutions[0].values[0] && resolutions[0].values[0].value.name;
    
    console.log(`Got slot '${slotName}' with value '${value}' resolved to '${resolved}'.`);
    return resolved;
}

resolveValue = (event, slotName) => {
    console.log(JSON.stringify(event.request.intent.slots, null, 4));
    var slot = event.request.intent.slots[slotName];
    return slot.value;
}

swear = () => {
    console.log(`Fetching swear word.`);
    return new Promise((resolve, reject) => {
        var body = "";
        https.get(`https://s3-eu-west-1.amazonaws.com/swear-words/swear-words.json`, (response) => {
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => {
            var data = JSON.parse(body);
            var idx = Math.ceil(Math.random() * data.length);
            var word = data[idx];
            
            console.log(`Got swear word. Selected ${idx}: ${word}`);
            resolve(word);
          })
        });
    });
}

findStation = (input) => {
    console.log(`Fetching stations: ${input}.`);
    return new Promise((resolve, reject) => {
        let body = "", options = {
            path: `/eza/mis/stations?like=${encodeURIComponent(input)}`,
            hostname: `www.cvag.de`,
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.134 Safari/537.36',
                'Referer': 'http://www.cvag.de/eza',
                'Accept-Encoding': 'gzip, deflate, sdch',
                'Accept-Language': 'de,en-US;q=0.8,en;q=0.6,de-DE;q=0.4'
            }
        };
        
        https.get(options, (response) => {
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => {
            console.log(`Request finished. ${body}`)
            
            const data = JSON.parse(body);
            //const data = JSON.parse('{"stations":[{"mandator":"CAG","number":152,"displayName":"Innere Klosterstraße"}]}');
            
            console.log(`Got stations.`);
            console.log(JSON.stringify(data, null, 4));
            
            resolve(data.stations[0]);
          })
        });
    });
}

departures = (stationID) => {
    console.log(`Fetching departures for station ${stationID}.`);
    return new Promise((resolve, reject) => {
        let body = "", options = {
            path: `/eza/mis/stops/station/${stationID}`,
            hostname: `www.cvag.de`,
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/43.0.2357.134 Safari/537.36',
                'Referer': 'http://www.cvag.de/eza/liste.html?station=' + stationID,
                'Accept-Encoding': 'gzip, deflate, sdch',
                'Accept-Language': 'de,en-US;q=0.8,en;q=0.6,de-DE;q=0.4'
            }
        };
        
        https.get(options, (response) => {
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => {
            console.log(`Request finished. ${body}`)
            
            const data = JSON.parse(body);
            console.log(`Got departures.`);
            console.log(JSON.stringify(data, null, 4));
            
            resolve(data.stops);
          })
        });
    });
}

tip = () => {
    console.log(`Fetching weather tip.`);
    return new Promise((resolve, reject) => {
        let body = "";
        https.get("https://api.darksky.net/forecast/7842fb1b0986cd14376f7f0a358126d5/50.8536168,12.73808095", (response) => {
          response.on('data', (chunk) => { body += chunk })
          response.on('end', () => {
            console.log(`Request finished. ${body}`)
            
            const data = JSON.parse(body);
            console.log(`Got weather.`);
            console.log(JSON.stringify(data, null, 4));
            
            const icon = data.currently.icon || "clear-day";
            console.log(icon);
            resolve(icon);
          })
        });
    }).then((icon) => {
        console.log("Got icon: " + icon);
        return {
            "clear-day": "Genieße den Tag, das Wetter ist freundlich",
            "clear-night": "Genieße die Nacht, das Wetter ist freundlich",
            "rain": "Packe besser einen Schirm oder eine Regenjacke ein, es regnet draußen",
            "snow": "Zieh dich warm an, es schneit draußen",
            "sleet": "Zieh dich warm an, es schneit draußen",
            "wind": "Draußen ist es ungemütlich, zieh dich vernünftsch an",
            "fog": "Draußen ist es ungemütlich, zieh dich vernünftsch an",
            "cloudy": "Draußen ist es ungemütlich, zieh dich vernünftsch an",
            "partly-cloudy-day": "Draußen ist es ungemütlich, zieh dich vernünftsch an",
            "partly-cloudy-night": "Draußen ist es ungemütlich, zieh dich vernünftsch an"
        }[icon];
    });
}

speak = (ssml) => {
    return {
        version: "1.0",
        sessionAttributes: {},
        response: {
            outputSpeech: {
                type: "SSML",
                ssml: `<speak>${ssml}</speak>`
            },
            shouldEndSession: true
        }
    }
}

spk = (txt) => {
    return {
        version: "1.0",
        sessionAttributes: {},
        response: {
            outputSpeech: {
              type: "PlainText",
              text: txt
            },
            shouldEndSession: true
        }
    }
}

sayTime = (str) => {
    const date = new Date(str);
    const minutes = (date.getMinutes() < 10) ? "0" + date.getMinutes() : date.getMinutes();
    return `um <say-as interpret-as="time">${date.getHours()}:${minutes}</say-as>`;
}

sayDate = (str) => {
    const date = new Date(str);
    const minutes = (date.getMinutes() < 10) ? "0" + date.getMinutes() : date.getMinutes();
    return `<say-as interpret-as="date" format="dm">${date.getDate()}/${date.getMonth() + 1}</say-as> `
           + `um <say-as interpret-as="time">${date.getHours()}:${minutes}</say-as>`;
}
