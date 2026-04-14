import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisConnection, redisEnabled } from '../config/redis';
import {
  signupStart,
  signupVerify,
  login,
  refresh,
  forgotPassword,
  resetPassword,
  googleAuth,
  logout,
  getMe,
  updateMe,
  updatePassword,
  addAddress,
  removeAddress,
  deleteMe,
} from '../controllers/authController';
import { protect } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { uploadAvatar, processAvatar } from '../middleware/upload';
import {
  signupStartSchema,
  signupVerifySchema,
  loginSchema,
  updateProfileSchema,
  addAddressSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updatePasswordSchema,
  googleAuthSchema,
  sendOtpSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from '../validation/schemas';
import { postSendOtp, postVerifyOtp, postResendOtp } from '../controllers/otpController';
import { createAdaptiveLimiter } from '../middleware/adaptiveRateLimit';

const router = Router();
const sensitiveAuthLimiter = createAdaptiveLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  prefix: 'rl:adaptive:auth:',
  message: 'Too many attempts. Please retry later.',
});
const loginLimiter = createAdaptiveLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  prefix: 'rl:adaptive:login:',
  message: 'Too many login attempts. Please wait 15 minutes before trying again.',
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => {
    const body = (req.body || {}) as { email?: string; type?: string };
    const email = String(body.email || '').toLowerCase().trim() || 'anon';
    const type = String(body.type || req.path || 'otp').toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${type}:${email}:${ip}`;
  },
  message: { status: 'error', message: 'Too many code requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisEnabled
    ? {
        store: new RedisStore({
          prefix: 'rl:otp:',
          sendCommand: (...args: string[]) =>
            redisConnection.call(args[0], ...(args.slice(1) as string[])) as Promise<
              string | number | boolean | (string | number | boolean)[]
            >,
        }),
      }
    : {}),
});

router.post('/signup/start', otpLimiter, validate(signupStartSchema), signupStart);
router.post('/signup/verify', otpLimiter, validate(signupVerifySchema), signupVerify);
/** Unified OTP API (immediate Zoho + Resend fallback). */
router.post('/send-otp', otpLimiter, validate(sendOtpSchema), postSendOtp);
router.post('/resend-otp', otpLimiter, validate(resendOtpSchema), postResendOtp);
router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), postVerifyOtp);
router.post('/login', loginLimiter, sensitiveAuthLimiter, validate(loginSchema), login);
router.post('/refresh', sensitiveAuthLimiter, refresh);
router.post('/forgot-password', otpLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', otpLimiter, validate(resetPasswordSchema), resetPassword);
router.post('/google', loginLimiter, sensitiveAuthLimiter, validate(googleAuthSchema), googleAuth);
router.post('/logout', logout);

router.use(protect);

router.get('/me', getMe);
router.patch('/update-me', uploadAvatar, processAvatar, validate(updateProfileSchema), updateMe);
router.patch(
  '/update-password',
  sensitiveAuthLimiter,
  validate(updatePasswordSchema),
  updatePassword,
);
router.delete('/delete-me', deleteMe);
router.post('/addresses', validate(addAddressSchema), addAddress);
router.delete('/addresses/:addressId', removeAddress);

export default router;
