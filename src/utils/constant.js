const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 5;
const POPULARITY_THRESHOLD = 1000
const allowOnboardingSteps = ['PHONE_VERIFICATION', 'PROFILE_SETUP', 'INTERESTS_SELECTION', 'COMMUNITY_RECOMMENDATIONS', 'COMPLETED']
const currency = ["USD", "INR"]

module.exports = {
    MAX_FILES,
    MAX_FILE_SIZE,
    POPULARITY_THRESHOLD,
    allowOnboardingSteps,
    currency
}