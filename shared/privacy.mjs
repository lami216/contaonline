export const PRIVACY_VERSION='2026-10-24';
export const OPEN_DELETION_STATUSES=['requested','in-review','needs-verification'];
/** Public contact settings, with no credential or customer data.
 * @param {any} config */
export function privacySettings(config={}){
  return {operator:config.privacyOperator||'payzone',email:config.privacyEmail||'pay21694@gmail.com',phone:config.supportPhone||'+22249823328',responseDays:Number.isInteger(config.privacyResponseDays)&&config.privacyResponseDays>=7&&config.privacyResponseDays<=60?config.privacyResponseDays:30};
}
