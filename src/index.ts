import RingCentral from '@rc-ex/core';
import PubNubExtension from '@rc-ex/pubnub';
import ExtensionTelephonySessionsEvent from '@rc-ex/core/lib/definitions/ExtensionTelephonySessionsEvent';
import CallSessionObject from '@rc-ex/core/lib/definitions/CallSessionObject';
import RTCAudioStreamSource from 'node-webrtc-audio-stream-source';
import wrtc from 'wrtc';
import Softphone from 'ringcentral-softphone';
import waitFor from 'wait-for-async';

const rc = new RingCentral({
  server: process.env.RINGCENTRAL_SERVER_URL,
  clientId: process.env.RINGCENTRAL_CLIENT_ID,
  clientSecret: process.env.RINGCENTRAL_CLIENT_SECRET,
});

let conferenceCreated = false;
let conferenceReady = false;
let conferenceSessionId = '';
let userAPartyId = '';
let voiceCallToken = '';

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
      const telephonySessionId = event.body!.telephonySessionId!;
      const party = event.body!.parties![0];

      // create conference
      if (
        !conferenceCreated &&
        party.direction === 'Inbound' &&
        party.status?.code === 'Answered' &&
        party.to?.phoneNumber?.includes(process.env.HOST_NUMBER!)
      ) {
        userAPartyId = party.id!;
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
        voiceCallToken = conferenceSession.voiceCallToken!;
      }

      // bring user A to conference
      if (
        conferenceCreated &&
        party.direction === 'Outbound' &&
        party.to?.phoneNumber === 'conference' &&
        party.status?.code === 'Answered'
      ) {
        conferenceReady = true;
        const callParty = await rc
          .restapi()
          .account()
          .telephony()
          .sessions(conferenceSessionId)
          .parties()
          .bringIn()
          .post({
            telephonySessionId,
            partyId: userAPartyId,
          });
        console.log(
          'User A is in conference:',
          JSON.stringify(callParty, null, 2)
        );
      }

      // bring user B to conference
      if (
        conferenceCreated &&
        party.status?.code === 'Answered' &&
        party.to?.phoneNumber?.includes(process.env.USER_B_NUMBER!) &&
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
          'User B is in conference:',
          JSON.stringify(callParty, null, 2)
        );
      }
    }
  );
};

// create a phone
const autoPhone = async () => {
  await waitFor({interval: 1000, condition: () => rc.token !== undefined});

  const rtcAudioStreamSource = new RTCAudioStreamSource();
  const track = rtcAudioStreamSource.createTrack();
  const inputAudioStream = new wrtc.MediaStream();
  inputAudioStream.addTrack(track);
  const softphone = new Softphone(rc);
  await softphone.register();

  // auto answer incoming call
  softphone.on('INVITE', async (sipMessage: any) => {
    softphone.answer(sipMessage);
  });

  // auto dial voiceCallToken
  await waitFor({interval: 1000, condition: () => voiceCallToken !== ''});
  await softphone.invite(voiceCallToken, inputAudioStream);

  // auto call user B
  await waitFor({interval: 1000, condition: () => conferenceReady});
  await softphone.invite(process.env.USER_B_NUMBER, inputAudioStream);
};

main();
autoPhone();
