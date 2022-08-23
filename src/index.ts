import RingCentral from '@rc-ex/core';
import PubNubExtension from '@rc-ex/pubnub';
import ExtensionTelephonySessionsEvent from '@rc-ex/core/lib/definitions/ExtensionTelephonySessionsEvent';
import CallSessionObject from '@rc-ex/core/lib/definitions/CallSessionObject';

const rc = new RingCentral({
  server: process.env.RINGCENTRAL_SERVER_URL,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
});

let conferenceCreated = false;
let conferenceSessionId = '';
let driverPartyId = '';
const main = async () => {
  await rc.authorize({
    username: process.env.RINGCENTRAL_USERNAME!,
    extension: process.env.RINGCENTRAL_EXTENSION,
    password: process.env.RINGCENTRAL_PASSWORD!,
  });
  const pubNubExtension = new PubNubExtension();
  await rc.installExtension(pubNubExtension);
  pubNubExtension.subscribe(
    ['/restapi/v1.0/account/~/extension/~/telephony/sessions'],
    async (event: ExtensionTelephonySessionsEvent) => {
      // console.log(JSON.stringify(event, null, 2));
      const telephonySessionId = event.body!.telephonySessionId!;
      const party = event.body!.parties![0];

      // create conference
      if (
        !conferenceCreated &&
        party.direction === 'Inbound' &&
        party.status?.code === 'Answered' &&
        party.to?.phoneNumber?.includes(process.env.HOST_NUMBER!)
      ) {
        driverPartyId = party.id!;
        conferenceCreated = true;
        const r = await rc.post(
          '/restapi/v1.0/account/~/telephony/conference',
          {}
        );
        const conferenceSession = (r.data as any).session as CallSessionObject;
        console.log(
          'Conference is created:',
          JSON.stringify(conferenceSession, null, 2)
        );
        conferenceSessionId = conferenceSession.id!;
      }

      // bring driver to conference
      if (
        conferenceCreated &&
        party.direction === 'Outbound' &&
        party.to?.phoneNumber === 'conference' &&
        party.status?.code === 'Answered'
      ) {
        const callParty = await rc
          .restapi()
          .account()
          .telephony()
          .sessions(conferenceSessionId)
          .parties()
          .bringIn()
          .post({
            telephonySessionId,
            partyId: driverPartyId,
          });
        console.log(
          'Driver is in conference:',
          JSON.stringify(callParty, null, 2)
        );
      }

      // bring customer to conference
      if (
        conferenceCreated &&
        party.status?.code === 'Answered' &&
        party.to?.phoneNumber?.includes(process.env.CUSTOMER_NUMBER!) &&
        party.direction === 'Outbound'
      ) {
        const callParty = await rc
          .restapi()
          .account()
          .telephony()
          .sessions(conferenceSessionId)
          .parties()
          .bringIn()
          .post({
            telephonySessionId,
            partyId: party.id,
          });
        console.log(
          'Customer is in conference:',
          JSON.stringify(callParty, null, 2)
        );
      }
    }
  );
};

main();
