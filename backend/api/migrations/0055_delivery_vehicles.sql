-- Larger delivery vehicles: vans and trucks join motorcycles, bikes, cars and foot. Groceries, convenience
-- stores and the other non-restaurant sellers Tunakula is open to need bigger vehicles, so riders can now
-- register and go online as VAN or TRUCK. Additive: the allowed set only grows, so every existing row and
-- rider keeps working unchanged.
ALTER TABLE dispatch.rider_presence DROP CONSTRAINT IF EXISTS rider_presence_vehicle_check;
ALTER TABLE dispatch.rider_presence
  ADD CONSTRAINT rider_presence_vehicle_check CHECK (vehicle IN ('MOTO', 'BICYCLE', 'CAR', 'VAN', 'TRUCK', 'FOOT'));

ALTER TABLE onboarding.rider_application DROP CONSTRAINT IF EXISTS rider_application_vehicle_check;
ALTER TABLE onboarding.rider_application
  ADD CONSTRAINT rider_application_vehicle_check CHECK (vehicle IN ('MOTO', 'BICYCLE', 'CAR', 'VAN', 'TRUCK', 'FOOT'));
