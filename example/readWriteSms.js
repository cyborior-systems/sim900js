const SIM900 = require('..');

var s = new SIM900('COM12', 9600);
s.connect((err) => {
    if (!err) {
        console.log('Connected Successfully to GSM Modem');
        console.log('Sending SMS');
        s.sendSMS("917838787829", "This is a test sms", (error, res) => {
            if (!error) {
                console.log("Message Sent Successfylly Res: ", res);
            } else {
                console.log("Message Sending failed. Error: " + error);
            }
        });
    }
});