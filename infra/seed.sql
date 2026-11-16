-- УВАГА: це ПРИКЛАДИ. Замініть на реальні заклади й акції (20-30 шт.) перед тестуванням!
insert into places (name, category, address, instagram, lat, lng) values
 ('Приклад Кава 1', 'coffee', 'просп. Свободи, 1', 'https://instagram.com/', 49.8419, 24.0315),
 ('Приклад Кава 2', 'coffee', 'вул. Дорошенка, 10', 'https://instagram.com/', 49.8405, 24.0290),
 ('Приклад Їдальня', 'food',  'вул. Городоцька, 5', 'https://instagram.com/', 49.8372, 24.0210);

insert into deals (place_id, title, description, conditions, days, time_from, time_to, ends_on)
select id, '-20% на капучино', 'Для студентів зі студентським', 'Показати студентський', '{1,2,3,4,5}', '08:00', '12:00', current_date + 30
from places where name = 'Приклад Кава 1';
insert into deals (place_id, title, description, conditions, days, time_from, time_to, ends_on)
select id, '2 кави = ціна однієї', 'Друга кава в подарунок', 'Лише у непіковий час', '{1,2,3,4,5,6,7}', '14:00', '17:00', current_date + 14
from places where name = 'Приклад Кава 2';
insert into deals (place_id, title, description, conditions, days, time_from, time_to, ends_on)
select id, 'Бізнес-ланч 120 грн', 'Суп + основна страва + напій', 'Будні', '{1,2,3,4,5}', '12:00', '15:00', current_date + 21
from places where name = 'Приклад Їдальня';
