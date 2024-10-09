const nodemailer = require('nodemailer');

const { HOST = '127.0.0.1', PORT = '2526' } = process.env;

const transporter = nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: false, // Use `true` for port 465, `false` for all other ports
});

async function sendEmail() {
  const info = await transporter.sendMail({
    cc: ['farsheed@dnamicro.com', 'bon@dnamicro.com'],
    bcc: ['support@dnamicro.com'],
    from: '"Maddison Foo Koch" <maddison53@ethereal.email>', // sender address
    to: 'bar@example.com, baz@example.com', // list of receivers
    subject: 'Hello ✔', // Subject line
    html: '<b>Hello world?</b>', // html body
  });

  console.log('Message sent:', info);
}

sendEmail().catch(console.error);
